/**
 * Contabilidad del panel de Finanzas con datos REALES del SII y del banco, leídos por
 * Emisso Connect. Todo acá es solo lectura.
 *
 *  - IVA del mes: sale del Registro de Compras y Ventas (RCV) del SII, documento por
 *    documento, más los totales que el SII informa sin detalle (boletas).
 *      débito  = IVA de facturas y notas de débito emitidas − notas de crédito + boletas
 *      crédito = IVA de facturas y notas de débito recibidas y REGISTRADAS − notas de crédito
 *      resultado = débito − crédito
 *    Es una estimación para saber cuánto se viene: el F29 real además considera remanente
 *    de meses anteriores, PPM, retenciones y compras sin derecho a crédito.
 *
 *  - Banco: movimientos y saldos ya sincronizados de la cuenta. Leerlos no contacta al banco.
 */

import { callEmisso, hasEmissoKey, type EmissoResult } from '@/lib/emisso'
import { supabaseAdmin } from '@/lib/supabase'
import { fetchAllRows } from '@/lib/server/fetchAllRows'
import { flowService } from '@/lib/flowService'
import type { BankMonth, BankMovement, FlowMonth, IvaLine, IvaMonth } from '@/lib/accountingTypes'

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/
const MAX_PAGES = 10

export function normalizePeriod(raw: unknown): string {
  if (typeof raw === 'string' && PERIOD_RE.test(raw)) return raw
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date()).slice(0, 7)
}

const line = (): IvaLine => ({ count: 0, net: 0, iva: 0 })
const add = (target: IvaLine, doc: any, countAs = 1) => {
  target.count += countAs
  target.net += Number(doc.montoNeto) || 0
  target.iva += Number(doc.montoIva) || 0
}

/** Lee todas las páginas de una tool de lectura de Emisso. */
async function readAll(
  tool: string,
  input: Record<string, unknown>,
  listKey: string,
  connectionId?: string
): Promise<{ rows: any[]; meta: any; error: string | null; truncated: boolean }> {
  const rows: any[] = []
  let cursor: string | null = null
  let meta: any = null
  for (let page = 0; page < MAX_PAGES; page++) {
    const result: EmissoResult<any> = await callEmisso<any>(tool, { ...input, limit: 500, ...(cursor ? { cursor } : {}) }, { connectionId, timeoutMs: 30_000 })
    if (!result.ok) return { rows, meta, error: `${result.error.message} (${result.error.code})`, truncated: false }
    rows.push(...(Array.isArray(result.data?.[listKey]) ? result.data[listKey] : []))
    meta = result.data?.sincronizacion ?? meta
    cursor = result.data?.cursor || null
    if (!cursor) return { rows, meta, error: null, truncated: false }
  }
  return { rows, meta, error: null, truncated: true }
}

export async function getIvaMonth(rawPeriod: unknown): Promise<IvaMonth> {
  const period = normalizePeriod(rawPeriod)
  const empty: IvaMonth = {
    period,
    configured: false,
    error: null,
    syncedAt: null,
    complete: false,
    sales: { invoices: line(), debitNotes: line(), creditNotes: line(), receipts: line(), cardVouchers: line() },
    purchases: { invoices: line(), debitNotes: line(), creditNotes: line(), exempt: line(), pending: line() },
    debit: 0,
    credit: 0,
    result: 0,
  }
  if (!hasEmissoKey() || !process.env.EMISSO_CONNECTION_ID) return empty

  const [sales, purchases, totals] = await Promise.all([
    readAll('sii.rcv.consultar', { periodo: period, perspectiva: 'ventas' }, 'documentos'),
    readAll('sii.rcv.consultar', { periodo: period, perspectiva: 'compras' }, 'documentos'),
    readAll('sii.rcv_totales.consultar', { periodo: period, perspectiva: 'ventas' }, 'totales'),
  ])
  const out: IvaMonth = { ...empty, configured: true }
  out.error = sales.error || purchases.error || totals.error
  out.syncedAt = sales.meta?.sincronizadoEn || purchases.meta?.sincronizadoEn || null
  out.complete = Boolean(sales.meta?.completo && purchases.meta?.completo) && !sales.truncated && !purchases.truncated

  for (const doc of sales.rows) {
    if (doc.tipoDte === 61) add(out.sales.creditNotes, doc)
    else if (doc.tipoDte === 56) add(out.sales.debitNotes, doc)
    else add(out.sales.invoices, doc)
  }
  for (const total of totals.rows) {
    // `sumable: false` (pagos con tarjeta) puede repetir ventas que ya tienen boleta.
    add(total.sumable ? out.sales.receipts : out.sales.cardVouchers, total, Number(total.cantidad) || 0)
  }
  for (const doc of purchases.rows) {
    if (String(doc.estado).toLowerCase() !== 'registro') add(out.purchases.pending, doc)
    else if (doc.tipoDte === 61) add(out.purchases.creditNotes, doc)
    else if (doc.tipoDte === 56) add(out.purchases.debitNotes, doc)
    else if (doc.tipoDte === 34) {
      out.purchases.exempt.count += 1
      out.purchases.exempt.net += Number(doc.montoExento) || Number(doc.montoTotal) || 0
    } else add(out.purchases.invoices, doc)
  }

  out.debit = out.sales.invoices.iva + out.sales.debitNotes.iva - out.sales.creditNotes.iva + out.sales.receipts.iva
  out.credit = out.purchases.invoices.iva + out.purchases.debitNotes.iva - out.purchases.creditNotes.iva
  out.result = out.debit - out.credit
  return out
}

export async function getBankMonth(rawPeriod: unknown): Promise<BankMonth> {
  const period = normalizePeriod(rawPeriod)
  const connectionId = process.env.EMISSO_BANK_CONNECTION_ID
  const empty: BankMonth = { period, configured: false, error: null, movements: [], credits: 0, debits: 0, balances: [], truncated: false }
  if (!hasEmissoKey() || !connectionId) return empty

  const [movs, saldos] = await Promise.all([
    readAll('banco_estado.movimientos.consultar', { periodo: period }, 'movimientos', connectionId),
    readAll('banco_estado.saldos.consultar', {}, 'saldos', connectionId),
  ])
  const movements: BankMovement[] = movs.rows.map((m: any) => {
    // El banco informa el monto con su sentido en campos distintos según el movimiento.
    const cargo = Number(m.cargo) || 0
    const abono = Number(m.abono) || 0
    const raw = Number(m.monto) || 0
    // Emisso informa el sentido en `type` con el eje del LIBRO DEL BANCO, al revés de la
    // cartola: 'debit' = entra plata (abono) y 'credit' = sale (cargo), y el `monto` siempre
    // en positivo; `display` trae el signo (negativo = sale). Verificado el 21-10-2026 con el
    // saldo arrastrado de BancoEstado YME: 10 de 10 movimientos comprobables calzan con
    // 'debit' = entra. Antes se leía al revés y el panel mostraba los cargos como abonos.
    const type = String(m.type || m.tipo || m.sentido || '').toLowerCase()
    const display = typeof m.display === 'string' ? m.display.trim() : ''
    const isCredit = display
      ? !display.startsWith('-')
      : type
        ? type === 'debit' || type.includes('abono')
        : abono > 0 || (cargo === 0 && raw > 0)
    const amount = Math.abs(abono || cargo || raw)
    return {
      date: String(m.fecha || m.fechaMovimiento || m.fechaContable || '').slice(0, 10),
      description: String(m.descripcion || m.glosa || m.detalle || '').slice(0, 160),
      amount,
      kind: isCredit ? 'abono' : 'cargo',
      account: m.numeroCuenta ? String(m.numeroCuenta) : null,
      provisional: String(m.estado || '').toLowerCase() === 'provisorio',
    }
  })
  return {
    period,
    configured: true,
    error: movs.error || saldos.error,
    movements,
    credits: movements.filter((m) => m.kind === 'abono').reduce((sum, m) => sum + m.amount, 0),
    debits: movements.filter((m) => m.kind === 'cargo').reduce((sum, m) => sum + m.amount, 0),
    balances: saldos.rows.map((s: any) => ({
      account: String(s.numeroCuenta || s.cuenta || ''),
      balance: Number(s.saldoDisponible ?? s.saldo ?? s.saldoContable) || 0,
      date: s.fecha ? String(s.fecha).slice(0, 10) : null,
    })),
    truncated: movs.truncated,
  }
}

/**
 * Cobros de Flow del mes: lo que Flow dice que se pagó (su API, día por día) contra lo que
 * el panel tiene en su libro de cobros (`booking_payments` con orden de Flow). Solo lectura:
 * las diferencias se muestran, no se corrigen solas.
 */
export async function getFlowMonth(rawPeriod: unknown): Promise<FlowMonth> {
  const period = normalizePeriod(rawPeriod)
  const empty: FlowMonth = {
    period,
    configured: false,
    error: null,
    count: 0,
    total: 0,
    fees: 0,
    net: 0,
    ledgerCount: 0,
    ledgerTotal: 0,
    missingInPanel: [],
    missingInFlow: [],
  }
  if (!flowService.isConfigured()) return empty

  const [y, m] = period.split('-').map(Number)
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date())
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const days: string[] = []
  for (let d = 1; d <= lastDay; d++) {
    const day = `${period}-${String(d).padStart(2, '0')}`
    if (day <= today) days.push(day)
  }

  const out: FlowMonth = { ...empty, configured: true }
  const paid: any[] = []
  try {
    // De a 5 días a la vez: Flow no tiene una consulta por mes.
    for (let i = 0; i < days.length; i += 5) {
      const chunk = await Promise.all(days.slice(i, i + 5).map((day) => flowService.getPaymentsByDate(day)))
      for (const list of chunk) paid.push(...list.filter((p: any) => Number(p?.status) === 2))
    }
  } catch (error) {
    out.error = error instanceof Error ? error.message.slice(0, 200) : 'Flow no respondió'
    return out
  }

  // Flow puede listar el mismo pago en más de un día de consulta: se cuenta una vez.
  const byOrder = new Map<number, any>()
  for (const p of paid) if (p?.flowOrder) byOrder.set(Number(p.flowOrder), p)
  const flowPayments = Array.from(byOrder.values())
  out.count = flowPayments.length
  out.total = flowPayments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0)
  out.fees = flowPayments.reduce((sum, p) => sum + (Number(p.paymentData?.fee) || 0) + (Number(p.paymentData?.taxes) || 0), 0)
  out.net = out.total - out.fees

  // Sin `.limit`: antes de esto la lectura se cortaba sola en 1000 filas (`max-rows`
  // del proyecto) y el cuadre «IVA y banco» del mes quedaba con menos cobros de los que
  // hay. `fetchAllRows` paga el precio: orden estable con desempate por `id`.
  const { data: ledger } = await fetchAllRows<any>((from, to) =>
    supabaseAdmin
      .from('booking_payments')
      .select('quote_id, flow_order, flow_token, amount, status, paid_at, created_at')
      .gte('paid_at', `${period}-01T00:00:00-04:00`)
      .lt('paid_at', new Date(Date.UTC(y, m, 1, 4)).toISOString())
      .eq('status', 'approved')
      .order('paid_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to)
  )
  const flowLedger = ((ledger || []) as any[]).filter((l) => l.flow_order || l.flow_token)
  out.ledgerCount = flowLedger.length
  out.ledgerTotal = flowLedger.reduce((sum, l) => sum + (Number(l.amount) || 0), 0)

  const ledgerOrders = new Set(flowLedger.map((l) => Number(l.flow_order)).filter(Boolean))
  out.missingInPanel = flowPayments
    .filter((p) => !ledgerOrders.has(Number(p.flowOrder)))
    .map((p) => ({
      flowOrder: Number(p.flowOrder),
      commerceOrder: String(p.commerceOrder || ''),
      amount: Number(p.amount) || 0,
      date: String(p.paymentData?.date || p.requestDate || '').slice(0, 10),
    }))
  out.missingInFlow = flowLedger
    .filter((l) => l.flow_order && !byOrder.has(Number(l.flow_order)))
    .map((l) => ({ flowOrder: Number(l.flow_order) || null, quoteId: String(l.quote_id || ''), amount: Number(l.amount) || 0, date: String(l.paid_at || '').slice(0, 10) }))
  return out
}

