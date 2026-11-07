/**
 * Resumen financiero con filtros (Tomás, 15-10-2026): ingresos, costos, gastos, impuestos,
 * utilidad y rentabilidad de un rango de fechas, y opcionalmente solo de un tipo de servicio,
 * un cliente o un trabajador. Lo mismo se descarga en Excel.
 *
 * Sale de las mismas fuentes que el EERR: los servicios por FECHA DEL SERVICIO (Finanzas),
 * el pago a trabajadores (`getWorkerPay`) y los gastos de la empresa. El IVA de los servicios
 * es el de las reservas con boleta o factura (no el del SII).
 *
 * Con filtro de servicio, cliente o trabajador solo entra lo que se puede atribuir a esos
 * servicios: su valor, lo que se les paga a quienes fueron y los gastos rendidos en ellos.
 * Los gastos de la empresa, los sueldos base y las bonificaciones no son de un servicio y
 * quedan fuera (el resumen lo avisa).
 */

import { supabaseAdmin } from '@/lib/supabase'
import { getFinanceData } from '@/lib/finance'
import { getWorkerPay } from '@/lib/workerPay'
import { getExpenseCategories, groupByCategory, readCompanyExpenses } from '@/lib/companyExpenses'
import { countsForRevenue } from '@/lib/revenueBreakdown'
import { IVA_RATE } from '@/lib/taxDocument'
import { expenseCategoryLabel } from '@/lib/incomeStatementTypes'
import { honorariosGross } from '@/lib/workerPayTypes'
import type { FinanceReport, FinanceReportBooking, FinanceReportWorker, ServiceFilter } from '@/lib/financeReportTypes'

export class FinanceReportError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message)
    this.name = 'FinanceReportError'
  }
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const MAX_DAYS = 366

export async function getFinanceReport(params: {
  desde?: string | null
  hasta?: string | null
  servicio?: string | null
  cliente?: string | null
  trabajador?: string | null
}): Promise<FinanceReport> {
  const from = String(params.desde || '')
  const to = String(params.hasta || '')
  if (!DAY_RE.test(from) || !DAY_RE.test(to) || from > to) throw new FinanceReportError('Elige un rango de fechas válido.')
  if ((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 > MAX_DAYS) throw new FinanceReportError('El rango puede ser de hasta un año.')
  const service: ServiceFilter = params.servicio === 'mudanza' || params.servicio === 'domicilio' ? params.servicio : 'todos'
  const client = String(params.cliente || '').slice(0, 300)
  const workerId = String(params.trabajador || '').slice(0, 60)
  const filtered = service !== 'todos' || client !== '' || workerId !== ''

  const [finance, pay, company, { categories }, { data: rawRows, error: rawError }] = await Promise.all([
    getFinanceData(null, { desde: from, hasta: to }),
    getWorkerPay(from, to),
    readCompanyExpenses(from, to),
    getExpenseCategories(),
    supabaseAdmin
      .from('bookings')
      .select('*')
      .gte('scheduled_date', from)
      .lte('scheduled_date', to)
      .neq('status', 'cancelled'),
  ])
  if (rawError) throw new FinanceReportError('No se pudieron leer las reservas.', 500)
  const rawById = new Map(((rawRows || []) as any[]).map((b) => [b.id, b]))

  // Quién fue a cada trabajo y cuánto se le paga; gastos de terreno por trabajo.
  const crew = new Map<string, { workerId: string; name: string; amount: number }[]>()
  for (const r of pay.rows) for (const j of r.jobs) crew.set(j.id, [...(crew.get(j.id) || []), { workerId: r.workerId, name: r.name, amount: j.amount || 0 }])
  const fieldByBooking = new Map<string, number>()
  for (const r of pay.rows) for (const e of r.expenses) if (e.bookingId) fieldByBooking.set(e.bookingId, (fieldByBooking.get(e.bookingId) || 0) + e.amount)

  const all: FinanceReportBooking[] = []
  const clientOptions = new Map<string, string>()
  for (const b of finance.bookings) {
    const raw = rawById.get(b.id)
    if (!raw || !countsForRevenue(raw)) continue
    const isDomicilio = raw.booking_type === 'domicilio' || String(raw.quote_id || '').startsWith('DOMICILIO')
    const clientKey = raw.company_id ? `e:${raw.company_id}` : `p:${String(raw.client_email || raw.client_name || b.id).trim().toLowerCase()}`
    const clientLabel = b.company?.razon_social || raw.company_name || b.clientName || 'Sin nombre'
    clientOptions.set(clientKey, clientLabel)
    const document: FinanceReportBooking['document'] =
      b.invoice?.status === 'emitida' || b.taxDocument === 'factura' ? 'factura' : b.taxDocument === 'boleta' ? 'boleta' : b.taxDocument === 'sin_documento' ? 'sin_documento' : 'sin_definir'
    const net = document === 'factura' || document === 'boleta' ? Math.round(b.total / (1 + IVA_RATE)) : b.total
    const people = crew.get(b.id) || []
    const workerPay = people.reduce((sum, p) => sum + p.amount, 0)
    const fieldExpenses = fieldByBooking.get(b.id) || 0
    all.push({
      id: b.id,
      code: b.code,
      date: b.scheduledDate || raw.scheduled_date || '',
      client: clientLabel,
      clientKey,
      service: isDomicilio ? 'domicilio' : 'mudanza',
      document,
      total: b.total,
      iva: b.total - net,
      net,
      workerPay,
      fieldExpenses,
      margin: net - workerPay - fieldExpenses,
      workers: people.map((p) => p.name),
    })
  }
  const isCompany = (key: string) => key.startsWith('e:') || Boolean(rawById.get(all.find((x) => x.clientKey === key)?.id || '')?.is_company)
  const bookings = all.filter(
    (b) =>
      (service === 'todos' || b.service === service) &&
      (client === '' || (client === 'empresas' ? isCompany(b.clientKey) : client === 'personas' ? !isCompany(b.clientKey) : b.clientKey === client)) &&
      (workerId === '' || (crew.get(b.id) || []).some((p) => p.workerId === workerId))
  )
  const inScope = new Set(bookings.map((b) => b.id))

  // El sueldo base cuenta en el período en que TERMINA su mes (igual que el EERR).
  const endsInRange = (month: string) => {
    const [y, m] = month.split('-').map(Number)
    const last = `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`
    return last >= from && last <= to
  }
  const workers: FinanceReportWorker[] = pay.rows
    .map((r) => {
      const own = r.jobs.filter((j) => inScope.has(j.id))
      const jobsPay = own.reduce((sum, j) => sum + (j.amount || 0), 0)
      const base = filtered ? 0 : r.baseMonths.filter((b) => endsInRange(b.month)).reduce((sum, b) => sum + b.amount, 0)
      const adjustments = filtered ? 0 : r.bonusTotal
      const fieldExpenses = r.expenses.filter((e) => (filtered ? e.bookingId !== null && inScope.has(e.bookingId) : true)).reduce((sum, e) => sum + e.amount, 0)
      const honorarium = jobsPay + base + adjustments
      return {
        id: r.workerId,
        name: r.name,
        jobs: own.length,
        jobsPay,
        base,
        adjustments,
        fieldExpenses,
        honorariosRate: r.honorariosRate,
        // La retención va ENCIMA del líquido pactado y la paga la empresa (Tomás, 19-10-2026).
        retention: r.honorariosRate && honorarium > 0 ? honorariosGross(honorarium, r.honorariosRate) - honorarium : 0,
      }
    })
    .filter((w) => w.jobs > 0 || w.base !== 0 || w.adjustments !== 0 || w.fieldExpenses !== 0)

  const gross = bookings.reduce((sum, b) => sum + b.total, 0)
  const ivaDebito = bookings.reduce((sum, b) => sum + b.iva, 0)
  const net = gross - ivaDebito
  const workerPay = bookings.reduce((sum, b) => sum + b.workerPay, 0)
  const base = workers.reduce((sum, w) => sum + w.base, 0)
  const adjustments = workers.reduce((sum, w) => sum + w.adjustments, 0)
  // Sin filtro, todo gasto de terreno aprobado del período (también los que no se rindieron en un trabajo).
  const fieldExpenses = filtered ? bookings.reduce((sum, b) => sum + b.fieldExpenses, 0) : pay.rows.reduce((sum, r) => sum + r.expenses.reduce((s, e) => s + e.amount, 0), 0)
  const retention = workers.reduce((sum, w) => sum + w.retention, 0)
  const costsTotal = workerPay + base + adjustments + retention + fieldExpenses

  const companyRows = filtered ? [] : company.expenses
  const groups = groupByCategory(companyRows, categories)
  const companyExpensesTotal = groups.reduce((sum, g) => sum + g.net, 0)
  const ivaCredito = companyRows.reduce((sum, e) => sum + e.iva, 0)
  const result = net - costsTotal - companyExpensesTotal

  const bookingCode = new Map(all.map((b) => [b.id, b.code]))
  const fieldExpenseList = pay.rows
    .flatMap((r) =>
      r.expenses
        .filter((e) => (filtered ? e.bookingId !== null && inScope.has(e.bookingId) : true))
        .map((e) => ({ date: e.date, worker: r.name, name: e.name, amount: e.amount, bookingCode: e.bookingId ? bookingCode.get(e.bookingId) ?? null : null }))
    )
    .sort((a, b) => a.date.localeCompare(b.date))

  const undefinedDocCount = bookings.filter((b) => b.document === 'sin_definir').length
  const notes: string[] = []
  if (filtered) notes.push('Con filtro de servicio, cliente o trabajador quedan fuera los gastos de la empresa, los sueldos base y las bonificaciones: no son de un servicio en particular.')
  if (workerId) notes.push('Con filtro de trabajador entran los servicios en que participó, con lo que se le paga a toda la cuadrilla de esos servicios.')
  if (undefinedDocCount > 0) notes.push(`${undefinedDocCount} servicio${undefinedDocCount === 1 ? '' : 's'} sin documento definido (boleta, factura o sin documento): su IVA no está descontado.`)
  if (pay.unassignedJobs > 0 || pay.rows.some((r) => r.jobs.length > 0 && r.rule === null)) notes.push('Hay trabajos sin nadie asignado o personas sin regla de pago: ese costo no está en el resumen.')
  if (!filtered && ivaCredito === 0 && companyRows.length > 0) notes.push('Ningún gasto de la empresa tiene IVA anotado: el IVA crédito sale en cero.')
  notes.push('El IVA crédito es solo el de los gastos de la empresa con IVA anotado; los gastos rendidos por trabajadores no traen IVA.')
  const todayChile = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date())
  if (to > todayChile) {
    notes.push('El rango incluye días que todavía no pasan: esos servicios suman su ingreso, pero su pago a trabajadores recién entra cuando se hacen. La utilidad de esos días sale inflada.')
  }

  return {
    from,
    to,
    service,
    client,
    workerId,
    filtered,
    income: { services: bookings.length, gross, ivaDebito, net, undefinedDocCount },
    costs: { workerPay, base, adjustments, retention, fieldExpenses, total: costsTotal },
    companyExpenses: groups.map((g) => ({ label: g.label, net: g.net })),
    companyExpensesTotal,
    taxes: { ivaDebito, ivaCredito, ivaToPay: ivaDebito - ivaCredito, honorariosRetention: retention },
    result,
    margin: net > 0 ? Math.round((result / net) * 1000) / 10 : null,
    bookings,
    workers,
    expenses: companyRows.map((e) => ({
      date: e.date,
      category: expenseCategoryLabel(e.category, categories),
      description: e.description,
      provider: e.provider,
      docNumber: e.docNumber,
      amount: e.amount,
      iva: e.iva,
      net: e.amount - e.iva,
    })),
    fieldExpenseList,
    options: {
      clients: Array.from(clientOptions.entries())
        .map(([value, label]) => ({ value, label }))
        .sort((a, b) => a.label.localeCompare(b.label, 'es')),
      workers: pay.rows.filter((r) => r.jobs.length > 0).map((r) => ({ id: r.workerId, name: r.name })),
    },
    notes,
  }
}
