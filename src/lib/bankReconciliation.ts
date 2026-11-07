/**
 * CRUCE CON EL BANCO (Finanzas → EERR).
 *
 * Dos cruces del mismo mes entre la cartola de BancoEstado (vía Emisso) y el panel:
 *   Ingresos  abonos del banco ↔ cobros registrados en el panel que NO pasaron por Flow
 *             (transferencias y pagos manuales). Lo de Flow no se cruza uno a uno: Flow
 *             deposita varios pagos juntos y ya tiene su propio cruce en «IVA y banco».
 *   Gastos    cargos del banco ↔ gastos de la empresa (Finanzas → Gastos) y pagos
 *             registrados a trabajadores.
 *
 * Un movimiento calza con uno del panel cuando el monto es exactamente el mismo y las fechas
 * están a lo más a MATCH_DAYS días. Cada movimiento se usa una sola vez; entre varios
 * candidatos gana el de fecha más cercana. Es solo lectura: muestra las diferencias, no
 * corrige ni registra nada.
 */

import { supabaseAdmin } from '@/lib/supabase'
import { getBankMonth } from '@/lib/accounting'
import { fetchAllRows } from '@/lib/server/fetchAllRows'
import type { BankMovement, BankReconciliation, PanelEntry, ReconciliationSide } from '@/lib/accountingTypes'

/** Días de diferencia tolerados: una transferencia de viernes se abona el lunes. */
export const MATCH_DAYS = 4

const dayNumber = (date: string) => Math.round(Date.parse(`${date.slice(0, 10)}T00:00:00Z`) / 86_400_000)
const sum = (list: { amount: number }[]) => list.reduce((total, x) => total + x.amount, 0)

/** Empareja movimientos del banco con entradas del panel. Pura: se prueba sin base ni banco. */
export function matchEntries(bank: BankMovement[], panel: PanelEntry[]): ReconciliationSide {
  const free = new Set(panel.map((_, i) => i))
  const matched: ReconciliationSide['matched'] = []
  const onlyBank: BankMovement[] = []
  // Del más antiguo al más nuevo, para que el orden de la cartola no cambie el resultado.
  for (const movement of [...bank].sort((a, b) => a.date.localeCompare(b.date))) {
    let best = -1
    let bestGap = Infinity
    for (const i of Array.from(free)) {
      if (panel[i].amount !== movement.amount) continue
      const gap = Math.abs(dayNumber(panel[i].date) - dayNumber(movement.date))
      if (gap <= MATCH_DAYS && gap < bestGap) {
        best = i
        bestGap = gap
      }
    }
    if (best >= 0) {
      free.delete(best)
      matched.push({ bank: movement, panel: panel[best] })
    } else onlyBank.push(movement)
  }
  const onlyPanel = panel.filter((_, i) => free.has(i)).sort((a, b) => a.date.localeCompare(b.date))
  return {
    bankCount: bank.length,
    bankTotal: sum(bank),
    panelCount: panel.length,
    panelTotal: sum(panel),
    matched,
    matchedTotal: sum(matched.map((m) => m.bank)),
    onlyBank,
    onlyBankTotal: sum(onlyBank),
    onlyPanel,
    onlyPanelTotal: sum(onlyPanel),
  }
}

const METHOD_LABEL: Record<string, string> = { transfer: 'transferencia', transferencia: 'transferencia', cash: 'efectivo', efectivo: 'efectivo', flow: 'Flow' }

export async function getBankReconciliation(rawPeriod: unknown): Promise<BankReconciliation> {
  const bank = await getBankMonth(rawPeriod)
  const period = bank.period
  const [y, m] = period.split('-').map(Number)
  const from = `${period}-01`
  const to = `${period}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`
  // El mes en hora de Chile (UTC−3 en verano, UTC−4 en invierno): se pide con un día de
  // margen por lado y se filtra por el día chileno de cada cobro.
  const chileDay = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date(iso))
  const pad = (date: string, days: number) => new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString()

  // `fetchAllRows` y NO `.limit(3000)`: el proyecto tiene `max-rows=1000` en PostgREST y
  // ese techo corta CADA respuesta sin avisar, pedido el límite que se pida. Un mes con
  // más de 1000 filas en cualquiera de estas tablas se cruzaba incompleto y los totales
  // del cruce salían falsos (mismo bug que vació los leads viejos del panel 15-sep-2026).
  const [paymentsResult, expensesResult, workerPaymentsResult] = await Promise.all([
    fetchAllRows<any>((rfrom, rto) =>
      supabaseAdmin.from('booking_payments').select('*').eq('status', 'approved')
        .gte('paid_at', pad(from, -1)).lte('paid_at', pad(to, 1))
        .order('paid_at', { ascending: true }).order('id', { ascending: true }).range(rfrom, rto)
    ),
    fetchAllRows<any>((rfrom, rto) =>
      supabaseAdmin.from('company_expenses').select('*')
        .gte('expense_date', from).lte('expense_date', to)
        .order('expense_date', { ascending: true }).order('id', { ascending: true }).range(rfrom, rto)
    ),
    fetchAllRows<any>((rfrom, rto) =>
      supabaseAdmin.from('worker_payments').select('*')
        .gte('paid_at', pad(from, -1)).lte('paid_at', pad(to, 1))
        .order('paid_at', { ascending: true }).order('id', { ascending: true }).range(rfrom, rto)
    ),
  ])

  const payments = ((paymentsResult.data || []) as any[]).filter((p) => p.paid_at && chileDay(p.paid_at).startsWith(period))
  const flowPayments = payments.filter((p) => p.flow_order || p.flow_token)
  const manualPayments = payments.filter((p) => !p.flow_order && !p.flow_token)
  const bookingIds = Array.from(new Set(manualPayments.map((p) => p.booking_id).filter(Boolean)))
  const { data: bookings } = bookingIds.length
    ? await supabaseAdmin.from('bookings').select('id, code, client_name, payment_method').in('id', bookingIds)
    : { data: [] as any[] }
  const bookingById = new Map(((bookings || []) as any[]).map((b) => [b.id, b]))

  const incomePanel: PanelEntry[] = manualPayments.map((p) => {
    const booking = bookingById.get(p.booking_id)
    return {
      id: p.id,
      date: chileDay(p.paid_at),
      amount: Math.round(Number(p.amount) || 0),
      label: `Cobro ${[booking?.code, booking?.client_name].filter(Boolean).join(' · ') || p.quote_id || ''}`.trim(),
      source: 'cobro',
      detail: METHOD_LABEL[String(booking?.payment_method || '').toLowerCase()] || (booking?.payment_method ? String(booking.payment_method) : null),
    }
  })

  const workerIds = Array.from(new Set(((workerPaymentsResult.data || []) as any[]).map((p) => p.worker_id)))
  const { data: workers } = workerIds.length ? await supabaseAdmin.from('workers').select('id, name').in('id', workerIds) : { data: [] as any[] }
  const workerName = new Map(((workers || []) as any[]).map((w) => [w.id, w.name]))

  const expensePanel: PanelEntry[] = [
    ...((expensesResult.data || []) as any[]).map(
      (e): PanelEntry => ({
        id: e.id,
        date: e.expense_date,
        amount: Math.round(Number(e.amount) || 0),
        label: `Gasto: ${e.description}`,
        source: 'gasto',
        detail: [e.provider, e.doc_number ? `N° ${e.doc_number}` : null].filter(Boolean).join(' · ') || null,
      })
    ),
    ...((workerPaymentsResult.data || []) as any[])
      .filter((p) => p.paid_at && chileDay(p.paid_at).startsWith(period))
      .map(
        (p): PanelEntry => ({
          id: p.id,
          date: chileDay(p.paid_at),
          amount: Math.round(Number(p.amount) || 0),
          label: `Pago a ${workerName.get(p.worker_id) || 'trabajador'}`,
          source: 'pago_trabajador',
          detail: p.method || null,
        })
      ),
  ]

  // Los movimientos provisorios todavía pueden cambiar: se cruzan igual, la lista los marca.
  const abonos = bank.movements.filter((mv) => mv.kind === 'abono' && mv.amount > 0)
  const cargos = bank.movements.filter((mv) => mv.kind === 'cargo' && mv.amount > 0)

  return {
    period,
    bankConfigured: bank.configured,
    bankError: bank.error,
    bankHasData: bank.movements.length > 0,
    income: matchEntries(abonos, incomePanel.filter((e) => e.amount > 0)),
    expenses: matchEntries(cargos, expensePanel.filter((e) => e.amount > 0)),
    flowLedgerTotal: flowPayments.reduce((total, p) => total + (Number(p.amount) || 0), 0),
  }
}
