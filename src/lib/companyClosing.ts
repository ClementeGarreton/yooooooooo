/**
 * Tarifa por empresa y cierre por pallets o kilos (Tomás, 15 y 19-10-2026, para Monfiza).
 *
 * La tarifa es por TRAMOS: un precio neto por cada tramo de hasta N pallets o N kilos (Monfiza:
 * 1,28 UF por cada 2 pallets o 1.000 kg; si se pasa, otro tramo) y un recargo neto por trabajo
 * urgente (0,29 UF), todo + IVA. Cada reserva se cobra por pallets o por kilos (la mayoría por
 * pallets). En cada trabajo el trabajador anota, en orden, los pallets o kilos, el N° de OD, el
 * N° de guía o factura y una foto de la recepción (`/trabajos`); el admin puede corregirlos y
 * marca los urgentes.
 *
 * Al guardar el cierre, cada reserva queda con su monto neto EN UF (`price_uf`). Los pesos se
 * fijan al facturar, con la UF del día de la factura (invoicing.ts). En el cierre, los pesos
 * que se muestran son referenciales (UF de hoy o escrita a mano). Solo un Administrador puede
 * reabrir un cierre.
 */

import { supabaseAdmin } from '@/lib/supabase'
import { fetchAllRows } from '@/lib/server/fetchAllRows'
import { getUfSetting } from '@/lib/ufSetting'
import { UUID_RE } from '@/lib/companies'
import { readPricingConfig } from '@/lib/server/pricingConfigServer'
import { withExtraServicesDefaults } from '@/lib/extraServices'
import {
  RECEPTION_NOTE,
  customerFromNotes,
  odFromNotes,
  valueClosing,
  type ClosingSnapshot,
  type CompanyClosingData,
  type CompanyTariff,
  type SavedCompanyClosing,
  type TariffCurrency,
  type WorkerDelivery,
} from '@/lib/companyClosingTypes'

export class CompanyClosingError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message)
    this.name = 'CompanyClosingError'
  }
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const todayChile = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date())

/** Valor de la UF de un día, de mindicador.cl. null si no responde. Se guarda en caché un día. */
export async function getUfValue(day: string): Promise<number | null> {
  if (!DAY_RE.test(day)) return null
  // La UF puesta a mano en Configuración manda sobre la del día.
  const manual = await getUfSetting().catch(() => null)
  if (manual?.value) return manual.value
  return getUfOfDay(day)
}

/** La UF publicada para ese día (mindicador.cl), sin mirar la puesta a mano. */
export async function getUfOfDay(day: string): Promise<number | null> {
  if (!DAY_RE.test(day)) return null
  const [y, m, d] = day.split('-')
  try {
    const res = await fetch(`https://mindicador.cl/api/uf/${d}-${m}-${y}`, { next: { revalidate: 86_400 }, signal: AbortSignal.timeout(8000) })
    if (!res.ok) return null
    const body = await res.json()
    const value = Number(body?.serie?.[0]?.valor)
    return Number.isFinite(value) && value > 0 ? value : null
  } catch {
    return null
  }
}

function tariffOf(company: any): CompanyTariff {
  const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v))
  const currency = (v: unknown): TariffCurrency => (v === 'CLP' ? 'CLP' : 'UF')
  return {
    closingUnit: company.closing_unit === 'pallets' || company.closing_unit === 'kg' ? company.closing_unit : null,
    currency: currency(company.tariff_currency),
    tramoPrice: num(company.tramo_price),
    tramoPallets: num(company.tramo_pallets),
    tramoKg: num(company.tramo_kg),
    urgencyPrice: num(company.urgency_price),
  }
}

const savedOf = (c: any): SavedCompanyClosing => ({
  id: c.id,
  from: c.period_from,
  to: c.period_to,
  unit: c.unit,
  ufValue: c.uf_value === null ? null : Number(c.uf_value),
  totalClp: Number(c.total_clp) || 0,
  closedBy: c.closed_by ?? null,
  closedAt: c.closed_at,
  reopenedBy: c.reopened_by ?? null,
  reopenedAt: c.reopened_at ?? null,
})

async function companyRow(companyId: unknown): Promise<any> {
  if (typeof companyId !== 'string' || !UUID_RE.test(companyId)) throw new CompanyClosingError('Empresa no encontrada', 404)
  const { data } = await supabaseAdmin.from('companies').select('*').eq('id', companyId).maybeSingle()
  if (!data) throw new CompanyClosingError('Empresa no encontrada', 404)
  return data
}

/** Cierres vigentes de la empresa que tocan esa fecha o rango. */
async function openClosings(companyId: string, from: string, to: string): Promise<SavedCompanyClosing[]> {
  const { data, error } = await supabaseAdmin
    .from('company_closings')
    .select('*')
    .eq('company_id', companyId)
    .is('reopened_at', null)
    .lte('period_from', to)
    .gte('period_to', from)
  return error ? [] : ((data || []) as any[]).map(savedOf)
}

/**
 * Los trabajos de la empresa en el período, valorizados. `rawUf` = valor de la UF escrito a
 * mano; sin él se usa la UF del último día del período (o de hoy, si el período no terminó).
 */
export async function getCompanyClosing(companyId: unknown, rawFrom: unknown, rawTo: unknown, rawUf?: unknown): Promise<CompanyClosingData> {
  const company = await companyRow(companyId)
  const today = todayChile()
  const from = typeof rawFrom === 'string' && DAY_RE.test(rawFrom) ? rawFrom : `${today.slice(0, 8)}01`
  const to = typeof rawTo === 'string' && DAY_RE.test(rawTo) ? rawTo : today
  if (from > to) throw new CompanyClosingError('El período no es válido.')
  const available = 'closing_unit' in company
  const tariff = tariffOf(company)

  const [{ data: bookings, error }, closingsResult] = await Promise.all([
    // `fetchAllRows`: el `.limit(2000)` pedía más de lo que PostgREST entrega
    // (`max-rows=1000`); una empresa con período largo cerraba con trabajos de menos.
    fetchAllRows<any>((rfrom, rto) =>
      supabaseAdmin
        .from('bookings')
        .select('*')
        .eq('company_id', company.id)
        .gte('scheduled_date', from)
        .lte('scheduled_date', to)
        .not('status', 'in', '(cancelled,no_show)')
        .order('scheduled_date', { ascending: true })
        .order('id', { ascending: true })
        .range(rfrom, rto)
    ),
    supabaseAdmin.from('company_closings').select('*').eq('company_id', company.id).order('closed_at', { ascending: false }).limit(50),
  ])
  if (error) throw new CompanyClosingError('No se pudieron leer los trabajos de la empresa.', 500)
  const jobs = ((bookings || []) as any[]).filter((b) => !b.is_provisional)

  const photosByBooking = new Map<string, { id: string; fileName: string }[]>()
  if (jobs.length > 0) {
    // Todas las fotos y documentos del trabajo, no solo los marcados «Foto de recepción»: el
    // equipo los sube desde «Subir archivo» con otra nota o sin nota, y el cierre no mostraba
    // ninguno (Tomás, 21-10-2026: «las fotos cargadas no se están mostrando»). Los marcados
    // como recepción van primero. Los gastos no son respaldo de la entrega.
    const { data: photos } = await supabaseAdmin
      .from('documents')
      .select('id, file_name, booking_id, note, created_at')
      .in('kind', ['foto', 'documento'])
      .in('booking_id', jobs.map((j) => j.id))
      .order('created_at', { ascending: true })
    const sorted = ((photos || []) as any[]).sort((a, b) => Number(b.note === RECEPTION_NOTE) - Number(a.note === RECEPTION_NOTE))
    for (const p of sorted) {
      photosByBooking.set(p.booking_id, [...(photosByBooking.get(p.booking_id) || []), { id: p.id, fileName: p.file_name || p.note || 'foto' }])
    }
  }

  // Pesos referenciales: con la UF de hoy (los definitivos se fijan con la del día de la factura).
  const manualUf = Number(String(rawUf ?? '').replace(',', '.'))
  const ufDay = today
  const uf =
    rawUf !== undefined && rawUf !== null && rawUf !== '' && Number.isFinite(manualUf) && manualUf > 0
      ? { value: manualUf, date: ufDay, source: 'manual' as const }
      : await getUfSetting()
          .catch(() => null)
          .then(async (setting) =>
            setting?.value
              ? { value: setting.value, date: ufDay, source: 'manual' as const }
              : getUfOfDay(ufDay).then((value) => (value ? { value, date: ufDay, source: 'mindicador' as const } : null))
          )

  // Repaletizado: se cobra en pesos, con el monto de Configuración → Precios.
  const repalletizePrice = await readPricingConfig()
    .then((p) => withExtraServicesDefaults(p.additionalServices).repalletize)
    .catch(() => 0)

  const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v))
  const { rows, totals } = valueClosing(
    jobs.map((b) => ({
      bookingId: b.id,
      code: b.code ?? null,
      date: b.scheduled_date,
      requestedBy: b.client_name || '',
      unit: (b.delivery_unit === 'kg' || b.delivery_unit === 'pallets' ? b.delivery_unit : tariff.closingUnit || 'pallets') as 'pallets' | 'kg',
      pallets: num(b.pallets),
      kg: num(b.delivery_kg),
      odNumber: b.od_number || odFromNotes(b.notes),
      guideNumber: b.guide_number || null,
      urgent: Boolean(b.is_urgent),
      repalletize: Boolean(b.repalletize),
      customer: customerFromNotes(b.notes),
      receptionPhotos: photosByBooking.get(b.id) || [],
      note: b.closing_note || null,
    })),
    tariff,
    uf?.value ?? null,
    repalletizePrice
  )

  const closings = closingsResult.error ? [] : ((closingsResult.data || []) as any[]).map(savedOf)
  const outside = await pendingOutside(company.id, from, to, today, closings)
  return {
    available: available && !closingsResult.error,
    company: { id: company.id, code: company.code, razonSocial: company.razon_social, rut: company.rut },
    from,
    to,
    tariff,
    uf,
    repalletizePrice,
    rows,
    totals,
    closings,
    overlapping: closings.find((c) => !c.reopenedAt && c.from <= to && c.to >= from) || null,
    outside,
  }
}

/**
 * Trabajos de la empresa hasta hoy que el período deja afuera y siguen sin cerrar (no están en
 * un cierre vigente ni en una factura), con cuántos tienen fotos o documentos. Sin esto, un
 * trabajo con otra fecha simplemente no aparecía en el cierre (Francisco, 27-10-2026).
 */
async function pendingOutside(
  companyId: string,
  from: string,
  to: string,
  today: string,
  closings: SavedCompanyClosing[]
): Promise<CompanyClosingData['outside']> {
  const { data, error } = await fetchAllRows<any>((rfrom, rto) =>
    supabaseAdmin
      .from('bookings')
      .select('id, scheduled_date, is_provisional')
      .eq('company_id', companyId)
      .lte('scheduled_date', today)
      .or(`scheduled_date.lt.${from},scheduled_date.gt.${to}`)
      .not('status', 'in', '(cancelled,no_show)')
      .order('scheduled_date', { ascending: true })
      .order('id', { ascending: true })
      .range(rfrom, rto)
  )
  if (error) return null
  const open = closings.filter((c) => !c.reopenedAt)
  const candidates = ((data || []) as any[]).filter(
    (b) => !b.is_provisional && b.scheduled_date && !open.some((c) => c.from <= b.scheduled_date && c.to >= b.scheduled_date)
  )
  const invoiced = await invoicedBookingIds(candidates.map((b) => b.id))
  const jobs = candidates.filter((b) => !invoiced.has(b.id))
  if (jobs.length === 0) return null
  const { data: files } = await supabaseAdmin.from('documents').select('booking_id').in('kind', ['foto', 'documento']).in('booking_id', jobs.map((b) => b.id))
  const dates = jobs.map((b) => String(b.scheduled_date)).sort()
  return {
    count: jobs.length,
    withFiles: new Set(((files || []) as any[]).map((f) => f.booking_id)).size,
    from: dates[0],
    to: dates[dates.length - 1],
  }
}

/** Tarifa de cierre de la empresa. Body: `{ closingUnit, currency, tramoPrice, tramoPallets, tramoKg, urgencyPrice }`. */
export async function setCompanyTariff(companyId: unknown, body: any): Promise<{ name: string; before: CompanyTariff; after: CompanyTariff }> {
  const company = await companyRow(companyId)
  if (!('tramo_price' in company)) throw new CompanyClosingError('Falta correr la migración add_cierre_empresas.sql.', 409)
  const value = (raw: unknown, what: string, positive = false) => {
    if (raw === null || raw === undefined || raw === '') return null
    const n = Number(String(raw).replace(',', '.'))
    if (!Number.isFinite(n) || n < 0 || (positive && n === 0) || n > 100_000_000) throw new CompanyClosingError(`${what} no es válido.`)
    return Math.round(n * 10_000) / 10_000
  }
  if (body?.currency !== 'UF' && body?.currency !== 'CLP') throw new CompanyClosingError('La moneda debe ser UF o pesos.')
  const unit = body?.closingUnit === 'pallets' || body?.closingUnit === 'kg' ? body.closingUnit : null
  if (body?.closingUnit && !unit) throw new CompanyClosingError('Elige cerrar por pallets o por kilos.')
  const update = {
    closing_unit: unit,
    tariff_currency: body.currency,
    tramo_price: value(body?.tramoPrice, 'El precio por tramo'),
    tramo_pallets: value(body?.tramoPallets, 'Los pallets por tramo', true),
    tramo_kg: value(body?.tramoKg, 'Los kilos por tramo', true),
    urgency_price: value(body?.urgencyPrice, 'El recargo de urgencia'),
  }
  const { error } = await supabaseAdmin.from('companies').update(update).eq('id', company.id)
  if (error) throw new CompanyClosingError('No se pudo guardar la tarifa.', 500)
  return { name: company.razon_social, before: tariffOf(company), after: tariffOf({ ...company, ...update }) }
}

/** Texto corto: N° de OD o de guía. Vacío = null. */
const shortText = (raw: unknown, what: string): string | null => {
  if (raw === null || raw === undefined) return null
  const value = String(raw).trim()
  if (!value) return null
  if (value.length > 40) throw new CompanyClosingError(`El ${what} es demasiado largo.`)
  return value
}

/**
 * Datos de la entrega de un trabajo de empresa: pallets, kilos, N° de OD, N° de guía o
 * factura y (solo el admin) si fue urgente, el repaletizado y la observación del cierre.
 * Solo cambia lo que viene. No se toca un trabajo
 * que ya está en un cierre guardado.
 */
export async function setDeliveryData(
  bookingId: unknown,
  body: any,
  options: { admin: boolean; companyId?: string }
): Promise<{ label: string; changes: Record<string, { from: string; to: string }> }> {
  if (typeof bookingId !== 'string' || !UUID_RE.test(bookingId)) throw new CompanyClosingError('Trabajo no encontrado', 404)
  const { data: booking } = await supabaseAdmin.from('bookings').select('*').eq('id', bookingId).maybeSingle()
  // De empresa, o del servicio «Pallets» (que puede no tener empresa).
  if (!booking || (!booking.company_id && booking.service_type !== 'pallets') || (options.companyId && booking.company_id !== options.companyId)) {
    throw new CompanyClosingError('Trabajo no encontrado', 404)
  }
  if (!('od_number' in booking)) throw new CompanyClosingError('Falta correr la migración add_cierre_empresas.sql.', 409)
  if (booking.company_id && booking.scheduled_date && (await openClosings(booking.company_id, booking.scheduled_date, booking.scheduled_date)).length > 0) {
    throw new CompanyClosingError('Ese trabajo ya está en un cierre guardado. Para cambiarlo, un Administrador tiene que reabrir el cierre.', 409)
  }

  const update: Record<string, unknown> = {}
  if ('pallets' in body) {
    const value = body.pallets === null || body.pallets === '' ? null : Math.round(Number(body.pallets))
    if (value !== null && (!Number.isFinite(value) || value < 0 || value > 100_000)) throw new CompanyClosingError('La cantidad de pallets no es válida.')
    update.pallets = value
  }
  if ('kg' in body) {
    const value = body.kg === null || body.kg === '' ? null : Math.round(Number(String(body.kg).replace(',', '.')) * 100) / 100
    if (value !== null && (!Number.isFinite(value) || value < 0 || value > 10_000_000)) throw new CompanyClosingError('Los kilos no son válidos.')
    update.delivery_kg = value
  }
  if ('unit' in body) {
    if (body.unit !== 'pallets' && body.unit !== 'kg') throw new CompanyClosingError('Elige pallets o kilos.')
    update.delivery_unit = body.unit
  }
  if ('odNumber' in body) update.od_number = shortText(body.odNumber, 'N° de OD')
  if ('guideNumber' in body) update.guide_number = shortText(body.guideNumber, 'N° de guía o factura')
  if ('urgent' in body) {
    if (!options.admin) throw new CompanyClosingError('La urgencia la marca la oficina.', 403)
    update.is_urgent = Boolean(body.urgent)
  }
  if ('note' in body) {
    if (!options.admin) throw new CompanyClosingError('Las observaciones del cierre las escribe la oficina.', 403)
    if (!('closing_note' in booking)) throw new CompanyClosingError('Falta correr la migración add_observaciones_cierre.sql.', 409)
    const value = body.note === null || body.note === undefined ? '' : String(body.note).trim().replace(/\s+/g, ' ')
    if (value.length > 300) throw new CompanyClosingError('La observación es demasiado larga (hasta 300 caracteres).')
    update.closing_note = value || null
  }
  if ('repalletize' in body) {
    if (!options.admin) throw new CompanyClosingError('El repaletizado lo marca la oficina.', 403)
    if (!('repalletize' in booking)) throw new CompanyClosingError('Falta correr la migración add_servicio_pallets.sql.', 409)
    update.repalletize = Boolean(body.repalletize)
  }

  const labels: Record<string, string> = { delivery_unit: 'se cobra por', pallets: 'pallets', delivery_kg: 'kilos', od_number: 'N° OD', guide_number: 'N° guía o factura', is_urgent: 'urgente', repalletize: 'repaletizado', closing_note: 'observaciones' }
  const show = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : v === true ? 'sí' : v === false ? 'no' : String(v))
  const changes: Record<string, { from: string; to: string }> = {}
  for (const [key, value] of Object.entries(update)) {
    if (show(booking[key]) !== show(value)) changes[labels[key]] = { from: show(booking[key]), to: show(value) }
  }
  const label = [booking.code, booking.client_name].filter(Boolean).join(' · ') || 'trabajo'
  if (Object.keys(changes).length === 0) return { label, changes }
  const { error } = await supabaseAdmin.from('bookings').update(update).eq('id', bookingId)
  if (error) throw new CompanyClosingError('No se pudieron guardar los datos de la entrega.', 500)
  return { label, changes }
}

/** Guarda el cierre del período. Body: `{ from, to, uf? }`. No se cierra dos veces lo mismo. */
export async function saveCompanyClosing(companyId: unknown, body: any, actor: string): Promise<{ name: string; snapshot: ClosingSnapshot }> {
  const data = await getCompanyClosing(companyId, body?.from, body?.to, body?.uf)
  if (!data.available) throw new CompanyClosingError('Falta correr la migración add_cierre_empresas.sql.', 409)
  if (!data.tariff.closingUnit) throw new CompanyClosingError('Primero define si la empresa se cierra por pallets o por kilos, y su tarifa.')
  if (data.to > todayChile()) throw new CompanyClosingError('El período termina después de hoy: se cierra cuando ya pasó.')
  if (data.rows.length === 0) throw new CompanyClosingError('No hay trabajos de la empresa en el período.')
  if (data.tariff.tramoPrice === null) throw new CompanyClosingError('Falta el precio por tramo en la tarifa de la empresa.')
  if (data.overlapping) throw new CompanyClosingError(`Ese período se cruza con el cierre del ${data.overlapping.from} al ${data.overlapping.to}.`, 409)

  const snapshot: ClosingSnapshot = {
    company: data.company,
    from: data.from,
    to: data.to,
    tariff: data.tariff,
    uf: data.uf,
    repalletizePrice: data.repalletizePrice,
    rows: data.rows,
    totals: data.totals,
  }
  const { data: saved, error } = await supabaseAdmin
    .from('company_closings')
    .insert({
      company_id: data.company.id,
      period_from: data.from,
      period_to: data.to,
      unit: data.tariff.closingUnit,
      uf_value: data.uf?.value ?? null,
      // Pesos referenciales (UF de hoy): los definitivos se fijan al facturar.
      // El repaletizado va en pesos, aparte del neto.
      total_clp: data.totals.netClp + (data.totals.repalletizeClp || 0),
      detail: snapshot,
      closed_by: actor,
    })
    .select('id')
    .single()
  if (error || !saved) throw new CompanyClosingError('No se pudo guardar el cierre.', 500)
  // Dos clics a la vez: si quedó otro cierre que se cruza, gana el primero.
  const overlapping = await openClosings(data.company.id, data.from, data.to)
  if (overlapping.length > 1 && overlapping.sort((a, b) => a.closedAt.localeCompare(b.closedAt))[0].id !== saved.id) {
    await supabaseAdmin.from('company_closings').delete().eq('id', saved.id)
    throw new CompanyClosingError('Ese período ya se cerró recién.', 409)
  }

  // Cada reserva queda con su monto. En UF: neto en UF, y los pesos se fijan al facturar con la
  // UF de ese día. En pesos: el precio queda puesto (con IVA, como todos los precios del panel).
  // Las que ya están en una factura no se tocan.
  const invoiced = await invoicedBookingIds(data.rows.map((r) => r.bookingId))
  for (const r of data.rows) {
    if (invoiced.has(r.bookingId)) continue
    const update =
      data.tariff.currency === 'UF'
        ? { price_uf: r.net > 0 ? r.net : null }
        : { adjusted_price: r.net > 0 ? Math.round(r.net * 1.19) : null, adjusted_by: actor, adjusted_at: new Date().toISOString(), adjustment_comment: `Cierre ${data.company.code} ${data.from} al ${data.to}` }
    await supabaseAdmin.from('bookings').update(update).eq('id', r.bookingId)
  }
  return { name: data.company.razonSocial, snapshot }
}

/** Reservas que ya entraron en una factura emitida o en curso: su monto ya no se cambia. */
async function invoicedBookingIds(bookingIds: string[]): Promise<Set<string>> {
  if (bookingIds.length === 0) return new Set()
  const { data } = await supabaseAdmin.from('invoice_bookings').select('booking_id, invoices(status)').in('booking_id', bookingIds)
  return new Set(
    ((data || []) as any[])
      .filter((l) => {
        const inv = Array.isArray(l.invoices) ? l.invoices[0] : l.invoices
        return inv && ['emitida', 'emitiendo', 'desconocido'].includes(inv.status)
      })
      .map((l) => l.booking_id)
  )
}

/** Un cierre guardado, con su detalle tal como quedó. */
export async function getSavedClosing(companyId: unknown, closingId: unknown): Promise<ClosingSnapshot> {
  const company = await companyRow(companyId)
  if (typeof closingId !== 'string' || !UUID_RE.test(closingId)) throw new CompanyClosingError('Cierre no encontrado', 404)
  const { data } = await supabaseAdmin.from('company_closings').select('detail').eq('id', closingId).eq('company_id', company.id).maybeSingle()
  if (!data) throw new CompanyClosingError('Cierre no encontrado', 404)
  return data.detail as ClosingSnapshot
}

/** Reabre un cierre (solo Administrador; lo valida la ruta). */
export async function reopenCompanyClosing(companyId: unknown, closingId: unknown, actor: string): Promise<{ name: string; from: string; to: string }> {
  const company = await companyRow(companyId)
  if (typeof closingId !== 'string' || !UUID_RE.test(closingId)) throw new CompanyClosingError('Cierre no encontrado', 404)
  const { data } = await supabaseAdmin
    .from('company_closings')
    .update({ reopened_by: actor, reopened_at: new Date().toISOString() })
    .eq('id', closingId)
    .eq('company_id', company.id)
    .is('reopened_at', null)
    .select('period_from, period_to, detail')
    .maybeSingle()
  if (!data) throw new CompanyClosingError('Ese cierre no existe o ya estaba reabierto.', 404)
  // Sus reservas vuelven a quedar sin monto en UF hasta el próximo cierre (salvo las ya facturadas).
  const ids = (((data.detail as ClosingSnapshot | null)?.rows || []) as ClosingSnapshot['rows']).map((r) => r.bookingId)
  const invoiced = await invoicedBookingIds(ids)
  const free = ids.filter((id) => !invoiced.has(id))
  if (free.length > 0) {
    await supabaseAdmin.from('bookings').update({ price_uf: null }).in('id', free)
    // Tarifa en pesos: el cierre había puesto el precio en la reserva; se saca solo el que puso
    // ESTE cierre (mismo comentario), para no borrar un ajuste hecho a mano.
    await supabaseAdmin
      .from('bookings')
      .update({ adjusted_price: null, adjusted_by: null, adjusted_at: null, adjustment_comment: null })
      .in('id', free)
      .eq('adjustment_comment', `Cierre ${company.code} ${data.period_from} al ${data.period_to}`)
  }
  return { name: company.razon_social, from: data.period_from, to: data.period_to }
}

/** Para el panel del trabajador: qué trabajos son de una empresa que se cierra por unidad, y lo ya anotado. */
export async function getDeliveriesFor(bookingIds: string[]): Promise<Map<string, WorkerDelivery>> {
  const out = new Map<string, WorkerDelivery>()
  if (bookingIds.length === 0) return out
  // De empresa, o del servicio «Pallets» (puede no tener empresa).
  const { data: all, error } = await supabaseAdmin.from('bookings').select('*').in('id', bookingIds)
  const bookings = ((all || []) as any[]).filter((b) => b.company_id || b.service_type === 'pallets')
  if (error || bookings.length === 0 || !('od_number' in bookings[0])) return out
  const companyIds = Array.from(new Set(bookings.map((b) => b.company_id).filter(Boolean)))
  const [{ data: companies }, { data: photos }] = await Promise.all([
    supabaseAdmin.from('companies').select('*').in('id', companyIds),
    // Cualquier foto o documento del trabajo cuenta como respaldo (ver getCompanyClosing).
    supabaseAdmin.from('documents').select('booking_id').in('kind', ['foto', 'documento']).in('booking_id', (bookings as any[]).map((b) => b.id)),
  ])
  const companyById = new Map(((companies || []) as any[]).map((c) => [c.id, c]))
  const photoCount = new Map<string, number>()
  for (const p of (photos || []) as any[]) photoCount.set(p.booking_id, (photoCount.get(p.booking_id) || 0) + 1)
  for (const b of bookings as any[]) {
    const company = b.company_id ? companyById.get(b.company_id) : undefined
    const closesByUnit = company?.closing_unit === 'pallets' || company?.closing_unit === 'kg'
    const palletService = b.service_type === 'pallets'
    if (!closesByUnit && !palletService) continue
    out.set(b.id, {
      company: company?.razon_social || b.company_name || b.client_name || 'el cliente',
      unit: b.delivery_unit === 'kg' || b.delivery_unit === 'pallets' ? b.delivery_unit : closesByUnit ? company.closing_unit : 'pallets',
      palletService,
      closesByUnit,
      pallets: b.pallets ?? null,
      kg: b.delivery_kg === null || b.delivery_kg === undefined ? null : Number(b.delivery_kg),
      odNumber: b.od_number || '',
      guideNumber: b.guide_number || '',
      photos: photoCount.get(b.id) || 0,
    })
  }
  return out
}

