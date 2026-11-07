/**
 * Facturación mensual por empresa con Emisso (etapa 2, paso 7 / Módulo 6).
 *
 * Decisión de Francisco (01-10-2026): la factura la EMITE EL ADMIN CON UN CLIC desde la
 * ficha de la empresa, revisando lo del mes. Nunca automática.
 *
 * Son dos pasos y los dos los da una persona:
 *   1. Vista previa (`sii.dte.previsualizar`): el SII calcula neto, IVA y total. No emite
 *      nada. Vence en 15 minutos.
 *   2. Emitir (`sii.dte.emitir`): con la vista previa vigente y una clave de idempotencia
 *      que se guardó ANTES de llamar. No hay ambiente de prueba: lo emitido es real.
 *
 * Reglas que no se negocian (documentación de Emisso, «Resultados y errores»):
 *   - Ante un resultado desconocido (corte, timeout, error no declarado como previo al
 *     envío) NO se previsualiza de nuevo ni se cambia la clave: se repite la misma llamada
 *     con la misma clave, que devuelve el estado guardado sin reenviar nada.
 *   - Una reserva no entra en dos facturas: mientras una factura esté emitiendo, emitida o
 *     en resultado desconocido, sus reservas quedan bloqueadas.
 *
 * Los precios de las reservas YA INCLUYEN IVA (ver taxDocument.ts). A Emisso se le manda
 * el NETO; el IVA y el total los calcula el SII, y pueden diferir en pesos del total del
 * panel por el redondeo. Esa diferencia se le muestra a quien emite.
 */

import { createHash } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase'
import { actualPaidAmount, servicePrice } from '@/lib/revenueBreakdown'
import { IVA_RATE } from '@/lib/taxDocument'
import { getUfValue } from '@/lib/companyClosing'
import { isValidRut, normalizeRut } from '@/lib/rut'
import {
  EMISSO_PRE_SEND_ERRORS,
  EMISSO_RETRY_SAME_KEY_ERRORS,
  callEmisso,
  isEmissoConfigured,
} from '@/lib/emisso'
import type { BillableBooking, InvoiceStatus, InvoiceView } from '@/lib/invoiceTypes'

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/

/** Estados en que una factura «tiene» sus reservas: no pueden ir en otra. */
const BLOCKING: InvoiceStatus[] = ['emitiendo', 'emitida', 'desconocido']
/** Máximo de líneas de una factura 33 en Emisso. */
const MAX_LINES = 10

export class InvoiceError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message)
    this.name = 'InvoiceError'
  }
}

/** 42P01 / PGRST205 = falta correr add_invoices.sql. */
export function isMissingInvoicesTable(error: { code?: string } | null | undefined): boolean {
  return error?.code === '42P01' || error?.code === 'PGRST205'
}

const INVOICE_FIELDS = `id, company_id, period, status, idempotency_key, preview_ref, preview_expires_at, detalles,
  neto, iva, total, panel_total, folio, operacion_id, fecha_emision, error_code, error_message,
  created_by, emitted_by, created_at`

function toView(row: any, bookingCount: number): InvoiceView {
  return {
    id: row.id,
    period: row.period,
    status: row.status,
    neto: row.neto,
    iva: row.iva,
    total: row.total,
    panelTotal: row.panel_total,
    folio: row.folio,
    operacionId: row.operacion_id,
    fechaEmision: row.fecha_emision,
    previewExpiresAt: row.preview_expires_at,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    detalles: Array.isArray(row.detalles) ? row.detalles : [],
    bookingCount,
    createdBy: row.created_by,
    emittedBy: row.emitted_by,
    createdAt: row.created_at,
  }
}

function periodRange(period: string): { from: string; to: string } {
  const [y, m] = period.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return { from: `${period}-01`, to: `${period}-${String(last).padStart(2, '0')}` }
}

/** Facturas (o intentos vivos) que ya cubren estas reservas. */
async function invoicedMap(bookingIds: string[]): Promise<Map<string, BillableBooking['invoiced']>> {
  const out = new Map<string, BillableBooking['invoiced']>()
  if (bookingIds.length === 0) return out
  const { data: links } = await supabaseAdmin.from('invoice_bookings').select('invoice_id, booking_id').in('booking_id', bookingIds)
  const invoiceIds = Array.from(new Set((links || []).map((l) => l.invoice_id)))
  if (invoiceIds.length === 0) return out
  const { data: invoices } = await supabaseAdmin.from('invoices').select('id, status, folio').in('id', invoiceIds).in('status', BLOCKING)
  const byId = new Map((invoices || []).map((i) => [i.id, i]))
  for (const link of links || []) {
    const inv = byId.get(link.invoice_id)
    if (inv) out.set(link.booking_id, { invoiceId: inv.id, status: inv.status as InvoiceStatus, folio: inv.folio })
  }
  return out
}

/**
 * Lo del mes de una empresa: sus reservas con fecha en ese mes (sin canceladas ni
 * pre-reservas), cada una con cotizado, ajustes aprobados, total y si ya está facturada;
 * y las facturas del período.
 */
export async function getCompanyBilling(companyId: string, period: string) {
  if (!UUID_RE.test(companyId) || !PERIOD_RE.test(period)) throw new InvoiceError('Empresa o período inválido.')
  const { from, to } = periodRange(period)

  const [bookingsResult, invoicesResult] = await Promise.all([
    supabaseAdmin
      .from('bookings')
      // `*`: price_uf (add_cierre_empresas.sql) es de una migración posterior.
      .select('*')
      .eq('company_id', companyId)
      .gte('scheduled_date', from)
      .lte('scheduled_date', to)
      .not('status', 'in', '(cancelled,no_show)')
      .order('scheduled_date', { ascending: true }),
    supabaseAdmin.from('invoices').select(INVOICE_FIELDS).eq('company_id', companyId).eq('period', period).order('created_at', { ascending: false }),
  ])
  if (bookingsResult.error) throw bookingsResult.error
  const available = !isMissingInvoicesTable(invoicesResult.error)
  if (invoicesResult.error && available) throw invoicesResult.error

  const rows = (bookingsResult.data || []).filter((b: any) => !b.is_provisional)
  const invoiced = available ? await invoicedMap(rows.map((b: any) => b.id)) : new Map()

  // Reservas con monto en UF (cierre de empresa, Tomás 19-10-2026): sin facturar, sus pesos se
  // calculan con la UF de hoy, que es el día de la factura. Al emitir quedan fijos en la reserva.
  const needsUf = rows.some((b: any) => Number(b.price_uf) > 0 && !invoiced.get(b.id))
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date())
  const ufToday = needsUf ? await getUfValue(today) : null

  const bookings: BillableBooking[] = rows.map((b: any) => {
    const priceUf = Number(b.price_uf) > 0 ? Number(b.price_uf) : null
    const inUf = priceUf !== null && !invoiced.get(b.id)
    const total = inUf ? (ufToday ? Math.round(priceUf * ufToday * (1 + IVA_RATE)) : 0) : servicePrice(b)
    const quoted = Number(b.original_price) || Number(b.total_price) || 0
    return {
      id: b.id,
      code: b.code,
      scheduledDate: b.scheduled_date,
      status: b.status,
      clientName: b.client_name,
      quoted,
      adjustments: total - quoted,
      total,
      paid: actualPaidAmount(b),
      invoiced: invoiced.get(b.id) || null,
      priceUf,
      ufValue: inUf ? ufToday : null,
    }
  })

  const invoiceRows = (invoicesResult.data || []) as any[]
  const counts = new Map<string, number>()
  if (invoiceRows.length > 0) {
    const { data: links } = await supabaseAdmin.from('invoice_bookings').select('invoice_id').in('invoice_id', invoiceRows.map((i) => i.id))
    for (const l of links || []) counts.set(l.invoice_id, (counts.get(l.invoice_id) || 0) + 1)
  }

  return {
    available,
    configured: isEmissoConfigured(),
    bookings,
    // Las vistas previas vencidas o reemplazadas no aportan nada: se muestra solo lo que
    // llegó a intentarse emitir.
    invoices: invoiceRows.filter((i) => i.status !== 'previsualizada').map((i) => toView(i, counts.get(i.id) || 0)),
  }
}

/** Datos del receptor tal como los exige la factura 33, o el error que dice qué falta. */
function buildReceptor(company: any) {
  const field = (value: unknown, label: string, max: number): string => {
    const s = String(value || '').trim()
    if (!s) throw new InvoiceError(`A la empresa le falta: ${label}. Complétalo en sus datos de facturación.`)
    if (s.length > max) throw new InvoiceError(`${label} tiene ${s.length} caracteres y el SII acepta hasta ${max}. Acórtalo en los datos de la empresa.`)
    return s
  }
  if (!isValidRut(company.rut)) throw new InvoiceError('El RUT de la empresa no es válido.')
  return {
    rut: normalizeRut(company.rut),
    razonSocial: field(company.razon_social, 'Razón social', 100),
    giro: field(company.giro, 'Giro', 40),
    direccion: field(company.direccion, 'Dirección', 70),
    comuna: field(company.comuna, 'Comuna', 20),
    ciudad: field(company.ciudad, 'Ciudad', 15),
  }
}

const netOf = (totalWithIva: number) => Math.round(totalWithIva / (1 + IVA_RATE))

/**
 * Paso 1: vista previa ante el SII de la factura del mes con las reservas elegidas. Guarda
 * la fila con su clave de idempotencia; no emite nada.
 */
export async function previewInvoice(
  companyId: string,
  period: string,
  bookingIds: unknown,
  actor: string
): Promise<InvoiceView> {
  if (!isEmissoConfigured()) throw new InvoiceError('La facturación no está configurada en el servidor (faltan las credenciales de Emisso).', 503)
  const ids: string[] = Array.isArray(bookingIds) ? Array.from(new Set(bookingIds.filter((id): id is string => typeof id === 'string' && UUID_RE.test(id)))) : []
  if (ids.length === 0) throw new InvoiceError('Elige al menos una reserva para facturar.')

  const billing = await getCompanyBilling(companyId, period)
  if (!billing.available) throw new InvoiceError('Falta correr la migración add_invoices.sql.', 503)
  const chosen = billing.bookings.filter((b) => ids.includes(b.id))
  if (chosen.length !== ids.length) throw new InvoiceError('Alguna de las reservas elegidas no es de esta empresa o de este mes.')
  const taken = chosen.find((b) => b.invoiced)
  if (taken) throw new InvoiceError(`La reserva ${taken.code || ''} ya está en una factura.`, 409)
  if (chosen.some((b) => b.priceUf && !b.ufValue)) throw new InvoiceError('No se pudo leer el valor de la UF de hoy (mindicador.cl). Intenta de nuevo en un rato.', 503)
  const empty = chosen.find((b) => b.total <= 0)
  if (empty) throw new InvoiceError(`La reserva ${empty.code || ''} no tiene precio. Ponle el monto antes de facturarla.`)

  const { data: company } = await supabaseAdmin
    .from('companies')
    .select('id, rut, razon_social, giro, direccion, comuna, ciudad')
    .eq('id', companyId)
    .maybeSingle()
  if (!company) throw new InvoiceError('Empresa no encontrada', 404)
  const receptor = buildReceptor(company)

  // Hasta 10 líneas, una por servicio. Con más, una sola línea por el mes: el detalle
  // servicio por servicio queda en el panel (invoice_bookings).
  const [year, month] = period.split('-')
  const detalles =
    chosen.length <= MAX_LINES
      ? chosen.map((b) => ({
          nombre: (b.code ? `Servicio ${b.code}` : 'Servicio de traslado').slice(0, 25),
          cantidad: 1,
          precioUnitario: netOf(b.total),
        }))
      : [{ nombre: `Servicios ${month}/${year}`, cantidad: 1, precioUnitario: chosen.reduce((sum, b) => sum + netOf(b.total), 0) }]

  const result = await callEmisso<any>('sii.dte.previsualizar', {
    candidato: {
      tipoDte: '33',
      receptor,
      tipoVenta: 'del_giro',
      tipoCompra: 'del_giro',
      condicionPago: { formaPago: 'credito' },
      detalles,
    },
  })
  if (!result.ok) {
    throw new InvoiceError(`Emisso no pudo previsualizar (${result.error.code}): ${result.error.message}`, 502)
  }
  const preview = result.data
  if (preview?.totales?.tributacion !== 'afecta' || !preview.previewRef) {
    throw new InvoiceError('Emisso devolvió una vista previa que no se reconoce. No se guardó nada.', 502)
  }

  const { data: invoice, error } = await supabaseAdmin
    .from('invoices')
    .insert({
      company_id: companyId,
      period,
      tipo_dte: '33',
      status: 'previsualizada',
      idempotency_key: globalThis.crypto.randomUUID(),
      preview_ref: preview.previewRef,
      preview_expires_at: preview.expiraEn,
      receptor,
      detalles,
      neto: preview.totales.neto,
      iva: preview.totales.iva,
      total: preview.totales.total,
      panel_total: chosen.reduce((sum, b) => sum + b.total, 0),
      request_id: result.requestId,
      created_by: actor,
    })
    .select(INVOICE_FIELDS)
    .single()
  if (error) throw error

  const { error: linkError } = await supabaseAdmin
    .from('invoice_bookings')
    .insert(chosen.map((b) => ({ invoice_id: invoice.id, booking_id: b.id, amount: b.total })))
  if (linkError) {
    await supabaseAdmin.from('invoices').delete().eq('id', invoice.id)
    throw linkError
  }
  return toView(invoice, chosen.length)
}

async function saveOutcome(invoiceId: string, patch: Record<string, unknown>) {
  const { data, error } = await supabaseAdmin
    .from('invoices')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', invoiceId)
    .select(INVOICE_FIELDS)
    .single()
  if (error) throw error
  return data
}

/**
 * Paso 2: emite la factura previsualizada. También sirve para CONSULTAR un intento que
 * quedó a medias (emitiendo o resultado desconocido): repite la misma llamada con la
 * misma clave, que no reenvía nada.
 *
 * El paso de `previsualizada` a `emitiendo` va con la condición en el UPDATE: si dos
 * personas aprietan «Emitir» a la vez, una sola llama a Emisso.
 */
export async function emitInvoice(invoiceId: string, actor: string): Promise<InvoiceView> {
  if (!UUID_RE.test(invoiceId)) throw new InvoiceError('Factura no encontrada', 404)
  if (!isEmissoConfigured()) throw new InvoiceError('La facturación no está configurada en el servidor.', 503)

  const { data: current } = await supabaseAdmin.from('invoices').select(INVOICE_FIELDS).eq('id', invoiceId).maybeSingle()
  if (!current) throw new InvoiceError('Factura no encontrada', 404)
  const { data: links } = await supabaseAdmin.from('invoice_bookings').select('booking_id').eq('invoice_id', invoiceId)
  const bookingIds = (links || []).map((l) => l.booking_id)

  if (current.status === 'previsualizada') {
    if (!current.preview_expires_at || new Date(current.preview_expires_at).getTime() < Date.now()) {
      throw new InvoiceError('La vista previa venció (dura 15 minutos). Previsualiza de nuevo.', 409)
    }
    const taken = await invoicedMap(bookingIds)
    if (taken.size > 0) throw new InvoiceError('Alguna de estas reservas ya entró en otra factura. Previsualiza de nuevo.', 409)

    const { data: claimed } = await supabaseAdmin
      .from('invoices')
      .update({ status: 'emitiendo', emitted_by: actor, updated_at: new Date().toISOString() })
      .eq('id', invoiceId)
      .eq('status', 'previsualizada')
      .select('id')
      .maybeSingle()
    if (!claimed) throw new InvoiceError('Otra persona ya está emitiendo esta factura.', 409)
  } else if (current.status !== 'emitiendo' && current.status !== 'desconocido') {
    throw new InvoiceError('Esta factura ya tiene un resultado final.', 409)
  }

  const result = await callEmisso<any>(
    'sii.dte.emitir',
    { previewRef: current.preview_ref },
    { idempotencyKey: current.idempotency_key, timeoutMs: 120_000 }
  )

  if (!result.ok) {
    const { code, message, requestId } = result.error
    if (EMISSO_PRE_SEND_ERRORS.has(code)) {
      return toView(await saveOutcome(invoiceId, { status: 'fallida', error_code: code, error_message: message, request_id: requestId }), bookingIds.length)
    }
    // Esperar y repetir con la misma clave: el intento sigue vivo, no cambia de estado.
    const status: InvoiceStatus = EMISSO_RETRY_SAME_KEY_ERRORS.has(code) ? 'emitiendo' : 'desconocido'
    return toView(await saveOutcome(invoiceId, { status, error_code: code, error_message: message, request_id: requestId }), bookingIds.length)
  }

  const outcome = result.data?.resultado
  if (outcome?.estado === 'emitido') {
    await fixUfPrices(invoiceId, outcome.folio, actor)
    return toView(
      await saveOutcome(invoiceId, {
        status: 'emitida',
        folio: outcome.folio,
        operacion_id: outcome.operacionId,
        fecha_emision: outcome.fechaEmision,
        confirmado_en: outcome.confirmadoEn,
        xml_firmado: outcome.xmlFirmado || null,
        error_code: null,
        error_message: null,
        request_id: result.requestId,
      }),
      bookingIds.length
    )
  }
  if (outcome?.estado === 'rechazado') {
    return toView(
      await saveOutcome(invoiceId, {
        status: 'rechazada',
        operacion_id: outcome.operacionId,
        error_code: outcome.codigo,
        error_message: 'El SII rechazó la factura. No se emitió.',
        request_id: result.requestId,
      }),
      bookingIds.length
    )
  }
  return toView(
    await saveOutcome(invoiceId, {
      status: 'desconocido',
      operacion_id: outcome?.operacionId || null,
      error_code: 'resultado_desconocido',
      error_message: 'Emisso todavía no puede afirmar si el SII la emitió. No previsualices de nuevo: consulta el resultado.',
      request_id: result.requestId,
    }),
    bookingIds.length
  )
}

/**
 * Al emitir: las reservas que estaban en UF quedan con su precio en pesos fijo (el monto con
 * que entraron en la factura, calculado con la UF del día de la factura). Desde ahí Finanzas
 * y el EERR las cuentan como cualquier otra.
 */
async function fixUfPrices(invoiceId: string, folio: string | null, actor: string): Promise<void> {
  const { data: links } = await supabaseAdmin.from('invoice_bookings').select('booking_id, amount').eq('invoice_id', invoiceId)
  if (!links || links.length === 0) return
  const { data: rows } = await supabaseAdmin.from('bookings').select('*').in('id', links.map((l) => l.booking_id))
  for (const b of (rows || []) as any[]) {
    if (!(Number(b.price_uf) > 0)) continue
    const amount = Math.round(Number(links.find((l) => l.booking_id === b.id)?.amount) || 0)
    if (amount <= 0) continue
    await supabaseAdmin
      .from('bookings')
      .update({
        adjusted_price: amount,
        adjusted_by: actor,
        adjusted_at: new Date().toISOString(),
        adjustment_comment: `${Number(b.price_uf).toLocaleString('es-CL')} UF + IVA, fijado al facturar${folio ? ` (factura ${folio})` : ''}`,
      })
      .eq('id', b.id)
  }
}

/** XML firmado de una factura emitida (es el documento tributario), o null. */
export async function getInvoiceXml(invoiceId: string): Promise<{ folio: string; xml: string } | null> {
  if (!UUID_RE.test(invoiceId)) return null
  const { data } = await supabaseAdmin.from('invoices').select('folio, xml_firmado, status').eq('id', invoiceId).maybeSingle()
  if (!data || data.status !== 'emitida' || !data.xml_firmado) return null
  return { folio: data.folio || 'sin-folio', xml: data.xml_firmado }
}

/**
 * El PDF oficial de una factura emitida, tal como lo muestra el Facturador Gratuito del SII.
 * No se guarda: se pide a Emisso cada vez por tipo, folio y fecha de emisión (lectura pura,
 * no emite nada) y se comprueba contra el SHA-256 que viene con él.
 */
export async function getInvoicePdf(
  invoiceId: string
): Promise<{ ok: true; fileName: string; bytes: Buffer } | { ok: false; status: number; error: string }> {
  if (!UUID_RE.test(invoiceId)) return { ok: false, status: 404, error: 'Factura no encontrada' }
  const { data } = await supabaseAdmin.from('invoices').select('folio, fecha_emision, tipo_dte, status').eq('id', invoiceId).maybeSingle()
  if (!data || data.status !== 'emitida') return { ok: false, status: 404, error: 'Factura no encontrada o todavía sin emitir' }
  const folio = String(data.folio || '').replace(/^0+/, '')
  // El SII muestra la fecha como DD/MM/AAAA; Emisso la pide AAAA-MM-DD. Se aceptan las dos.
  const rawDate = String(data.fecha_emision || '').trim()
  const dmy = rawDate.match(/^(\d{2})[/-](\d{2})[/-](\d{4})/)
  const fechaEmision = dmy ? `${dmy[3]}-${dmy[2]}-${dmy[1]}` : rawDate.slice(0, 10)
  if (!/^[1-9][0-9]{0,17}$/.test(folio) || !/^\d{4}-\d{2}-\d{2}$/.test(fechaEmision)) {
    return { ok: false, status: 409, error: 'La factura no tiene folio o fecha de emisión guardados: el PDF no se puede pedir al SII.' }
  }
  const result = await callEmisso<{ nombreArchivo: string; sha256: string; contenidoBase64: string }>(
    'sii.dte.descargar',
    { tipoDte: String(data.tipo_dte || '33'), folio, fechaEmision },
    { timeoutMs: 90_000 }
  )
  if (!result.ok) {
    return {
      ok: false,
      status: result.error.code === 'not_configured' ? 503 : 502,
      error: `El SII no entregó el PDF (${result.error.code}): ${result.error.message}`,
    }
  }
  const bytes = Buffer.from(result.data.contenidoBase64 || '', 'base64')
  const sha = createHash('sha256').update(bytes).digest('hex')
  if (bytes.length === 0 || (result.data.sha256 && sha !== result.data.sha256)) {
    return { ok: false, status: 502, error: 'El PDF llegó incompleto. Intenta de nuevo.' }
  }
  return { ok: true, fileName: `factura-${folio}.pdf`, bytes }
}

/** Facturas emitidas de una empresa, para el panel de su encargado. */
export async function listEmittedInvoices(companyId: string) {
  const { data, error } = await supabaseAdmin
    .from('invoices')
    .select('id, period, folio, fecha_emision, neto, iva, total')
    .eq('company_id', companyId)
    .eq('status', 'emitida')
    .order('fecha_emision', { ascending: false })
    .limit(60)
  if (error) {
    if (!isMissingInvoicesTable(error)) console.error('[invoicing] Error listando facturas:', error)
    return []
  }
  return data || []
}
