/**
 * Panel de Finanzas del admin: la plata de un mes en un solo lugar — lo reservado, lo
 * cobrado y lo que falta, servicio por servicio, y la facturación a empresas con Emisso.
 *
 * No calcula nada por su cuenta: usa las mismas funciones que Inicio y Reservas
 * (`summarizeBookings`, `servicePrice`, `pendingAmount`), para que los totales de las tres
 * pantallas no puedan contradecirse. El mes es por FECHA DEL SERVICIO, igual que en Inicio.
 */

import { IVA_RATE } from '@/lib/taxDocument'
import { supabaseAdmin } from '@/lib/supabase'
import { fetchAllRows } from '@/lib/server/fetchAllRows'
import { actualPaidAmount, countsForRevenue, pendingAmount, servicePrice, summarizeBookings } from '@/lib/revenueBreakdown'
import { isEmissoConfigured } from '@/lib/emisso'
import { isMissingInvoicesTable } from '@/lib/invoicing'
import type { InvoiceStatus } from '@/lib/invoiceTypes'
import type { FinanceBooking, FinanceCompany, FinanceData, FinanceInvoice, FinanceDocumentRow } from '@/lib/financeTypes'

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/
/** Estados en que una factura «tiene» sus reservas (misma lista que invoicing.ts). */
const BLOCKING: InvoiceStatus[] = ['emitiendo', 'emitida', 'desconocido']

export function currentPeriodChile(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date()).slice(0, 7)
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
/** Tope de un rango a medida: más que esto es un reporte, no el panel. */
const MAX_RANGE_DAYS = 366

/**
 * `rawPeriod` = un mes 'YYYY-MM' (lo que usa Emisión de facturas). `rawRange` = un rango de
 * días (lo que manda el filtro de fecha del panel); si viene completo y válido, manda él.
 */
export async function getFinanceData(
  rawPeriod: unknown,
  rawRange?: { desde?: string | null; hasta?: string | null }
): Promise<FinanceData> {
  let period = typeof rawPeriod === 'string' && PERIOD_RE.test(rawPeriod) ? rawPeriod : currentPeriodChile()
  const [y, m] = period.split('-').map(Number)
  let from = `${period}-01`
  let to = `${period}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`
  const desde = rawRange?.desde || ''
  const hasta = rawRange?.hasta || ''
  if (DAY_RE.test(desde) && DAY_RE.test(hasta) && desde <= hasta) {
    const days = (Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000
    if (Number.isFinite(days) && days <= MAX_RANGE_DAYS) {
      from = desde
      to = hasta
      period = hasta.slice(0, 7)
    }
  }

  // `*` a propósito: tax_document y company_id son columnas de migraciones posteriores y
  // pedirlas por nombre haría fallar todo el panel donde falte alguna.
  // `fetchAllRows` (antes sin `range` ni `limit`): sin esto el rango se cortaba solo en
  // 1000 reservas — `max-rows` de PostgREST — y la plancha de ingresos del mes calculaba
  // sobre un mes incompleto. Orden estable con desempate por `id`.
  const { data: rows, error } = await fetchAllRows<any>((rfrom, rto) =>
    supabaseAdmin
      .from('bookings')
      .select('*')
      .gte('scheduled_date', from)
      .lte('scheduled_date', to)
      .neq('status', 'cancelled')
      .order('scheduled_date', { ascending: true })
      .order('id', { ascending: true })
      .range(rfrom, rto)
  )
  if (error) throw error

  // Reservas reales: fuera los bloqueos de agenda y las pre-reservas que no se pagaron.
  const bookings = (rows || []).filter(
    (b: any) => !String(b.quote_id || '').startsWith('ADMIN-BLOQUEO-') && !(b.is_provisional && b.payment_status !== 'approved')
  )
  const revenue = summarizeBookings(bookings as any)

  const companyIds = Array.from(new Set(bookings.map((b: any) => b.company_id).filter(Boolean))) as string[]
  const { data: companyRows } = companyIds.length
    ? await supabaseAdmin.from('companies').select('id, code, razon_social').in('id', companyIds)
    : { data: [] as any[] }
  const companyById = new Map((companyRows || []).map((c: any) => [c.id, c]))

  // Facturas: las del período (para el listado) y las que cubren reservas del mes.
  const invoicesResult = await supabaseAdmin
    .from('invoices')
    .select('id, company_id, period, status, folio, total, fecha_emision, emitted_by, created_at')
    // Las facturas son por mes: entran las de los meses que toca el rango.
    .gte('period', from.slice(0, 7))
    .lte('period', to.slice(0, 7))
    .neq('status', 'previsualizada')
    .order('created_at', { ascending: false })
  const invoicesAvailable = !isMissingInvoicesTable(invoicesResult.error)
  if (invoicesResult.error && invoicesAvailable) throw invoicesResult.error

  const invoiceByBooking = new Map<string, { status: InvoiceStatus; folio: string | null }>()
  if (invoicesAvailable && bookings.length > 0) {
    const { data: links } = await supabaseAdmin
      .from('invoice_bookings')
      .select('booking_id, invoices(status, folio)')
      .in('booking_id', bookings.map((b: any) => b.id))
    for (const l of (links || []) as any[]) {
      const inv = Array.isArray(l.invoices) ? l.invoices[0] : l.invoices
      if (inv && BLOCKING.includes(inv.status)) invoiceByBooking.set(l.booking_id, { status: inv.status, folio: inv.folio })
    }
  }

  const list: FinanceBooking[] = bookings.map((b: any) => {
    const total = servicePrice(b)
    const quoted = Number(b.original_price) || Number(b.total_price) || 0
    const company = b.company_id ? companyById.get(b.company_id) : null
    return {
      id: b.id,
      code: b.code ?? null,
      quoteId: b.quote_id ?? null,
      scheduledDate: b.scheduled_date,
      status: b.status,
      clientName: b.client_name,
      company: company ? { id: company.id, razon_social: company.razon_social } : null,
      quoted,
      adjustments: total - quoted,
      total,
      paid: actualPaidAmount(b),
      pending: pendingAmount(b),
      taxDocument: b.tax_document ?? null,
      invoice: invoiceByBooking.get(b.id) || null,
    }
  })

  const companies: FinanceCompany[] = (companyRows || [])
    .map((c: any) => {
      const own = list.filter((b) => b.company?.id === c.id && b.total > 0)
      const unbilled = own.filter((b) => !b.invoice)
      return {
        id: c.id,
        code: c.code,
        razon_social: c.razon_social,
        unbilledCount: unbilled.length,
        unbilledTotal: unbilled.reduce((sum, b) => sum + b.total, 0),
        completedUnbilledCount: unbilled.filter((b) => b.status === 'completed').length,
        invoicedTotal: own.filter((b) => b.invoice?.status === 'emitida').reduce((sum, b) => sum + b.total, 0),
      }
    })
    .sort((a, b) => b.unbilledTotal - a.unbilledTotal)

  const allCompanyIds = Array.from(new Set((invoicesResult.data || []).map((i: any) => i.company_id)))
  const missing = allCompanyIds.filter((id) => !companyById.has(id))
  if (missing.length > 0) {
    const { data } = await supabaseAdmin.from('companies').select('id, code, razon_social').in('id', missing)
    for (const c of data || []) companyById.set(c.id, c)
  }
  const invoices: FinanceInvoice[] = ((invoicesResult.data || []) as any[]).map((i) => ({
    id: i.id,
    company: companyById.get(i.company_id)?.razon_social || 'Empresa',
    status: i.status,
    folio: i.folio,
    total: i.total,
    fechaEmision: i.fecha_emision,
    emittedBy: i.emitted_by,
  }))
  const emitted = invoices.filter((i) => i.status === 'emitida')

  // Ingresos por documento tributario. Un servicio con factura emitida cuenta como factura
  // aunque la reserva diga otra cosa. El IVA se saca del total del servicio (precios con
  // IVA incluido): neto = total / 1,19, igual que al facturar. Es el IVA de lo vendido en
  // el mes por fecha de servicio, no el de los documentos efectivamente emitidos ese mes.
  const DOC_LABEL: Record<FinanceDocumentRow['key'], string> = {
    factura: 'Factura',
    boleta: 'Boleta',
    sin_documento: 'Sin documento',
    sin_definir: 'Sin definir',
  }
  const docRows = new Map<FinanceDocumentRow['key'], FinanceDocumentRow>(
    (Object.keys(DOC_LABEL) as FinanceDocumentRow['key'][]).map((key) => [
      key,
      { key, label: DOC_LABEL[key], count: 0, total: 0, paid: 0, pending: 0, net: 0, iva: 0 },
    ])
  )
  // Mismo criterio que el resumen: un «no atendido» sale en la lista pero no suma.
  const counted = new Set(bookings.filter((b: any) => countsForRevenue(b)).map((b: any) => b.id))
  for (const b of list) {
    if (!counted.has(b.id)) continue
    const key: FinanceDocumentRow['key'] =
      b.invoice?.status === 'emitida' || b.taxDocument === 'factura'
        ? 'factura'
        : b.taxDocument === 'boleta'
          ? 'boleta'
          : b.taxDocument === 'sin_documento'
            ? 'sin_documento'
            : 'sin_definir'
    const row = docRows.get(key)!
    row.count += 1
    row.total += b.total
    row.paid += b.paid
    row.pending += b.pending
    if (key === 'factura' || key === 'boleta') {
      const net = Math.round(b.total / (1 + IVA_RATE))
      row.net += net
      row.iva += b.total - net
    }
  }
  const byDocument = Array.from(docRows.values())
  const withDoc = byDocument.filter((r) => r.key === 'factura' || r.key === 'boleta')

  return {
    period,
    from,
    to,
    summary: {
      booked: revenue.booked,
      paid: revenue.paid,
      paidCount: revenue.paidCount,
      pending: revenue.pending,
      pendingCount: revenue.pendingCount,
      paidByChannel: revenue.paidByChannel,
      invoiced: emitted.reduce((sum, i) => sum + (i.total || 0), 0),
      invoicedCount: emitted.length,
    },
    byDocument,
    ivaDebito: withDoc.reduce((sum, r) => sum + r.iva, 0),
    withDocumentTotal: withDoc.reduce((sum, r) => sum + r.total, 0),
    withoutDocumentTotal: byDocument.filter((r) => r.key === 'sin_documento' || r.key === 'sin_definir').reduce((sum, r) => sum + r.total, 0),
    bookings: list,
    companies,
    invoices,
    invoicesAvailable,
    emissoConfigured: isEmissoConfigured(),
  }
}
