/**
 * GASTOS DE LA EMPRESA Y ESTADO DE RESULTADOS (Finanzas → Gastos y Finanzas → EERR).
 *
 * Gastos: los que se cargan a mano acá (`company_expenses`) más, aparte y solo para mirar,
 * los que rindieron los trabajadores y se aprobaron.
 *
 * Estado de resultados de un período, por FECHA DEL SERVICIO (igual que el resto de Finanzas):
 *   ingresos netos   = valor de los servicios − IVA de los que llevan boleta o factura
 *   costo del servicio = pago a trabajadores (con bonificaciones) + gastos de terreno aprobados
 *   gastos de la empresa = los cargados a mano, netos de su IVA
 *   resultado        = ingresos netos − costo del servicio − gastos de la empresa
 * Es un resultado de GESTIÓN, armado con lo que hay en el panel: no reemplaza la
 * contabilidad del contador (no incluye depreciación, remuneraciones fuera del panel ni
 * impuesto a la renta).
 */

import { supabaseAdmin } from '@/lib/supabase'
import { fetchAllRows } from '@/lib/server/fetchAllRows'
import { getFinanceData } from '@/lib/finance'
import { getWorkerPay } from '@/lib/workerPay'
import { honorariosGross } from '@/lib/workerPayTypes'
import { getBankReconciliation } from '@/lib/bankReconciliation'
import { getIvaMonth } from '@/lib/accounting'
import {
  EXPENSE_CATEGORIES,
  categorySlug,
  expenseCategoryLabel,
  type CompanyExpense,
  type ExpenseCategory,
  type ExpenseCategoryOption,
  type ExpensesData,
  type IncomeStatement,
  type MonthlyIncomeStatement,
  type MonthlyStatement,
} from '@/lib/incomeStatementTypes'

export class ExpenseInputError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message)
    this.name = 'ExpenseInputError'
  }
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isMissingTable = (error: { code?: string } | null | undefined) => error?.code === '42P01' || error?.code === 'PGRST205'

function range(rawFrom: unknown, rawTo: unknown): { from: string; to: string } {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date())
  let from = typeof rawFrom === 'string' && DAY_RE.test(rawFrom) ? rawFrom : `${today.slice(0, 8)}01`
  let to = typeof rawTo === 'string' && DAY_RE.test(rawTo) ? rawTo : today
  if (from > to) [from, to] = [to, from]
  return { from, to }
}

// ───────────────────────── Categorías ─────────────────────────

/** Las categorías vigentes: las fijas del panel más las creadas (activas). Tolera que falte la tabla. */
export async function getExpenseCategories(): Promise<{ available: boolean; categories: ExpenseCategoryOption[] }> {
  const builtIn: ExpenseCategoryOption[] = EXPENSE_CATEGORIES.map((c) => ({ value: c.value, label: c.label, custom: false }))
  const { data, error } = await supabaseAdmin.from('expense_categories').select('slug, label, active').eq('active', true).order('label')
  if (error) return { available: false, categories: builtIn }
  const custom = ((data || []) as any[])
    .filter((c) => !builtIn.some((b) => b.value === c.slug))
    .map((c): ExpenseCategoryOption => ({ value: c.slug, label: c.label, custom: true }))
  // «Otros» siempre al final.
  return { available: true, categories: [...builtIn.filter((b) => b.value !== 'otros'), ...custom, ...builtIn.filter((b) => b.value === 'otros')] }
}

export async function addExpenseCategory(rawLabel: unknown, actor: string): Promise<ExpenseCategoryOption> {
  const label = typeof rawLabel === 'string' ? rawLabel.trim().replace(/\s+/g, ' ').slice(0, 60) : ''
  if (label.length < 2) throw new ExpenseInputError('Escribe el nombre de la categoría.')
  const slug = categorySlug(label)
  if (!slug) throw new ExpenseInputError('Ese nombre no sirve como categoría.')
  const { categories } = await getExpenseCategories()
  if (categories.some((c) => c.value === slug || c.label.toLowerCase() === label.toLowerCase())) {
    throw new ExpenseInputError('Ya existe una categoría con ese nombre.', 409)
  }
  // `upsert` reactiva una categoría que se había quitado antes con el mismo nombre.
  const { error } = await supabaseAdmin
    .from('expense_categories')
    .upsert({ slug, label, active: true, created_by: actor }, { onConflict: 'slug' })
  if (error) {
    if (isMissingTable(error)) throw new ExpenseInputError('Falta correr la migración add_expense_categories.sql.', 409)
    throw new ExpenseInputError('No se pudo crear la categoría', 500)
  }
  return { value: slug, label, custom: true }
}

/** Saca una categoría creada de la lista. Los gastos que ya la usan la conservan. */
export async function removeExpenseCategory(rawSlug: unknown): Promise<string> {
  const slug = typeof rawSlug === 'string' ? rawSlug : ''
  if (!slug || EXPENSE_CATEGORIES.some((c) => c.value === slug)) throw new ExpenseInputError('Esa categoría es del panel y no se puede quitar.')
  const { data, error } = await supabaseAdmin.from('expense_categories').update({ active: false }).eq('slug', slug).select('label').maybeSingle()
  if (error) throw new ExpenseInputError('No se pudo quitar la categoría', 500)
  if (!data) throw new ExpenseInputError('Categoría no encontrada', 404)
  return data.label
}

/** Categoría de un gasto rendido por un trabajador (`null` la quita). */
export async function setWorkerExpenseCategory(rawId: unknown, rawCategory: unknown): Promise<{ name: string; label: string }> {
  if (typeof rawId !== 'string' || !UUID_RE.test(rawId)) throw new ExpenseInputError('Gasto no encontrado', 404)
  const { categories } = await getExpenseCategories()
  const category = rawCategory === null || rawCategory === '' ? null : categories.find((c) => c.value === rawCategory)?.value
  if (category === undefined) throw new ExpenseInputError('Elige una categoría de la lista.')
  const { data: doc } = await supabaseAdmin.from('documents').select('id, kind, note, uploaded_by_type').eq('id', rawId).maybeSingle()
  if (!doc || doc.kind !== 'gasto' || doc.uploaded_by_type !== 'trabajador') throw new ExpenseInputError('Gasto no encontrado', 404)
  const { error } = await supabaseAdmin.from('documents').update({ expense_category: category }).eq('id', rawId)
  if (error) throw new ExpenseInputError('No se pudo guardar: falta correr la migración add_expense_categories.sql.', 409)
  return { name: doc.note || 'Gasto', label: category ? expenseCategoryLabel(category, categories) : 'sin categoría' }
}

export async function readCompanyExpenses(from: string, to: string): Promise<{ available: boolean; expenses: CompanyExpense[] }> {
  // `fetchAllRows`: `.limit(2000)` se cortaba en 1000 (`max-rows` de PostgREST) y el
  // total de gastos del período podía quedar corto sin ningún aviso.
  const { data, error } = await fetchAllRows<any>((rfrom, rto) =>
    supabaseAdmin
      .from('company_expenses')
      .select('*')
      .gte('expense_date', from)
      .lte('expense_date', to)
      .order('expense_date', { ascending: false })
      .order('id', { ascending: false })
      .range(rfrom, rto)
  )
  if (error) {
    if (!isMissingTable(error)) console.error('[companyExpenses] Error leyendo gastos:', error.message)
    return { available: false, expenses: [] }
  }
  return {
    available: true,
    expenses: ((data || []) as any[]).map((r) => ({
      id: r.id,
      date: r.expense_date,
      category: String(r.category || 'otros'),
      description: r.description,
      amount: Number(r.amount) || 0,
      iva: Number(r.iva) || 0,
      provider: r.provider ?? null,
      docNumber: r.doc_number ?? null,
      createdBy: r.created_by ?? null,
    })),
  }
}

export function groupByCategory(expenses: CompanyExpense[], categories: ExpenseCategoryOption[]) {
  // En el orden de la lista vigente; al final, las categorías que ya no están en la lista
  // pero todavía tienen gastos.
  const codes = [...categories.map((c) => c.value), ...Array.from(new Set(expenses.map((e) => e.category))).filter((code) => !categories.some((c) => c.value === code))]
  return codes
    .map((code) => {
      const own = expenses.filter((e) => e.category === code)
      const amount = own.reduce((sum, e) => sum + e.amount, 0)
      return { category: code, label: expenseCategoryLabel(code, categories), count: own.length, amount, net: amount - own.reduce((sum, e) => sum + e.iva, 0) }
    })
    .filter((g) => g.count > 0)
}

export async function getExpenses(rawFrom: unknown, rawTo: unknown): Promise<ExpensesData> {
  const { from, to } = range(rawFrom, rawTo)
  const bankPeriod = to.slice(0, 7)
  const [{ available, expenses }, pay, { available: categoriesAvailable, categories }, reconciliation] = await Promise.all([
    readCompanyExpenses(from, to),
    getWorkerPay(from, to),
    getExpenseCategories(),
    // El banco se lee por mes: se revisa el mes en que termina el período. Si falla, el
    // panel de gastos se muestra igual, sin esa sección.
    getBankReconciliation(bankPeriod).catch(() => null),
  ])

  const workerIds = pay.rows.flatMap((r) => r.expenses.map((e) => e.id))
  const { data: categoryRows, error: categoryError } = workerIds.length
    ? await supabaseAdmin.from('documents').select('id, expense_category').in('id', workerIds)
    : { data: [] as any[], error: null }
  const categoryOf = new Map<string, string | null>(categoryError ? [] : ((categoryRows || []) as any[]).map((r) => [r.id, r.expense_category ?? null]))

  const workerExpenses = pay.rows
    .flatMap((r) => r.expenses.map((e) => ({ id: e.id, date: e.date, name: e.name, amount: e.amount, worker: r.name, category: categoryOf.get(e.id) ?? null })))
    .sort((a, b) => b.date.localeCompare(a.date))

  const totals = new Map<string, { company: number; workers: number }>()
  const bump = (key: string, side: 'company' | 'workers', amount: number) => {
    const current = totals.get(key) || { company: 0, workers: 0 }
    current[side] += amount
    totals.set(key, current)
  }
  for (const e of expenses) bump(e.category, 'company', e.amount)
  for (const e of workerExpenses) bump(e.category || '', 'workers', e.amount)
  const order = [...categories.map((c) => c.value), ...Array.from(totals.keys()).filter((k) => k !== '' && !categories.some((c) => c.value === k)), '']
  const consolidated = order
    .filter((key) => totals.has(key))
    .map((key) => {
      const t = totals.get(key)!
      return { category: key || null, label: key ? expenseCategoryLabel(key, categories) : 'Sin categoría', company: t.company, workers: t.workers, total: t.company + t.workers }
    })

  return {
    from,
    to,
    available,
    expenses,
    total: expenses.reduce((sum, e) => sum + e.amount, 0),
    totalIva: expenses.reduce((sum, e) => sum + e.iva, 0),
    byCategory: groupByCategory(expenses, categories),
    workerExpenses,
    workerExpensesTotal: workerExpenses.reduce((sum, e) => sum + e.amount, 0),
    categories,
    categoriesAvailable: categoriesAvailable && !categoryError,
    consolidated,
    bankPending: (reconciliation?.expenses.onlyBank || []).map((m) => ({ date: m.date, description: m.description, amount: m.amount })),
    bankPeriod,
    bankHasData: Boolean(reconciliation?.bankHasData),
  }
}

export async function addExpense(body: any, actor: string): Promise<CompanyExpense> {
  const date = String(body?.date || '')
  if (!DAY_RE.test(date)) throw new ExpenseInputError('Elige la fecha del gasto.')
  const { categories } = await getExpenseCategories()
  const category = categories.find((c) => c.value === body?.category)?.value
  if (!category) throw new ExpenseInputError('Elige la categoría del gasto.')
  const description = typeof body?.description === 'string' ? body.description.trim().slice(0, 200) : ''
  if (description.length < 2) throw new ExpenseInputError('Escribe qué fue el gasto.')
  const amount = Math.round(Number(body?.amount))
  if (!Number.isFinite(amount) || amount <= 0 || amount > 500_000_000) throw new ExpenseInputError('Escribe el monto total, en pesos.')
  const iva = body?.iva === '' || body?.iva === null || body?.iva === undefined ? 0 : Math.round(Number(body.iva))
  if (!Number.isFinite(iva) || iva < 0 || iva > amount) throw new ExpenseInputError('El IVA no puede ser mayor que el total.')
  const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) || null : null)

  const { data, error } = await supabaseAdmin
    .from('company_expenses')
    .insert({
      expense_date: date,
      category,
      description,
      amount,
      iva,
      provider: text(body?.provider, 120),
      doc_number: text(body?.docNumber, 40),
      created_by: actor,
    })
    .select('*')
    .single()
  if (error || !data) {
    if (isMissingTable(error)) throw new ExpenseInputError('Falta correr la migración add_company_expenses.sql.', 409)
    throw new ExpenseInputError('No se pudo guardar el gasto', 500)
  }
  return {
    id: data.id,
    date: data.expense_date,
    category,
    description,
    amount,
    iva,
    provider: data.provider,
    docNumber: data.doc_number,
    createdBy: actor,
  }
}

export async function removeExpense(id: unknown): Promise<{ description: string; amount: number }> {
  if (typeof id !== 'string' || !UUID_RE.test(id)) throw new ExpenseInputError('Gasto no encontrado', 404)
  const { data } = await supabaseAdmin.from('company_expenses').select('description, amount').eq('id', id).maybeSingle()
  if (!data) throw new ExpenseInputError('Gasto no encontrado', 404)
  const { error } = await supabaseAdmin.from('company_expenses').delete().eq('id', id)
  if (error) throw new ExpenseInputError('No se pudo quitar el gasto', 500)
  return { description: data.description, amount: Number(data.amount) || 0 }
}

export async function getIncomeStatement(rawFrom: unknown, rawTo: unknown): Promise<IncomeStatement> {
  const { from, to } = range(rawFrom, rawTo)
  const [finance, pay, company, { categories }] = await Promise.all([
    getFinanceData(null, { desde: from, hasta: to }),
    getWorkerPay(from, to),
    readCompanyExpenses(from, to),
    getExpenseCategories(),
  ])

  const grossRevenue = finance.summary.booked
  const ivaDebito = finance.ivaDebito
  const netRevenue = grossRevenue - ivaDebito
  const workerBonuses = pay.rows.reduce((sum, r) => sum + r.bonusTotal, 0)
  // El sueldo base cuenta en el período en que TERMINA su mes: así el EERR mensual lo trae
  // una vez, y un rango suelto de días no carga un mes entero de base.
  const endsInRange = (month: string) => {
    const [y, m] = month.split('-').map(Number)
    const last = `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`
    return last >= from && last <= to
  }
  const workerBase = pay.rows.reduce((sum, r) => sum + r.baseMonths.filter((b) => endsInRange(b.month)).reduce((s, b) => s + b.amount, 0), 0)
  // Boleta de honorarios (Tomás, 19-10-2026): la retención va encima del líquido y la paga la
  // empresa: es costo del pago a trabajadores.
  const workerRetention = pay.rows.reduce((sum, r) => {
    if (!r.honorariosRate) return sum
    const net = (r.jobsDue || 0) + r.bonusTotal + r.baseMonths.filter((b) => endsInRange(b.month)).reduce((s, b) => s + b.amount, 0)
    return net > 0 ? sum + honorariosGross(net, r.honorariosRate) - net : sum
  }, 0)
  const workerPay = pay.rows.reduce((sum, r) => sum + (r.jobsDue || 0), 0) + workerBonuses + workerBase + workerRetention
  // Todo gasto de terreno aprobado es un costo, lo haya pagado el funcionario (contado) o la
  // empresa (crédito): acá no importa a quién se le debe, sino cuánto se gastó.
  const fieldExpenses = pay.rows.reduce((sum, r) => sum + r.expenses.reduce((s, e) => s + e.amount, 0), 0)
  const grossMargin = netRevenue - workerPay - fieldExpenses
  const groups = groupByCategory(company.expenses, categories)
  const companyExpensesTotal = groups.reduce((sum, g) => sum + g.net, 0)
  const result = grossMargin - companyExpensesTotal

  return {
    from: finance.from,
    to: finance.to,
    services: finance.byDocument.reduce((sum, d) => sum + d.count, 0),
    grossRevenue,
    ivaDebito,
    netRevenue,
    undefinedDocCount: finance.byDocument.find((d) => d.key === 'sin_definir')?.count || 0,
    undefinedDocTotal: finance.byDocument.find((d) => d.key === 'sin_definir')?.total || 0,
    workerPay,
    workerBonuses,
    workerPayIncomplete: pay.rows.some((r) => r.jobs.length > 0 && r.rule === null) || pay.unassignedJobs > 0,
    fieldExpenses,
    grossMargin,
    companyExpenses: groups.map((g) => ({ category: g.category, label: g.label, net: g.net })),
    companyExpensesTotal,
    companyExpensesAvailable: company.available,
    result,
    margin: netRevenue > 0 ? Math.round((result / netRevenue) * 1000) / 10 : null,
  }
}

/**
 * Estado de resultados MES A MES: los últimos `months` meses calendario, del más antiguo al
 * más nuevo, cada uno con el mismo cálculo de `getIncomeStatement`.
 *
 * El IVA que se descuenta de los ingresos es, cuando se puede leer, el débito que el SII
 * tiene registrado para ese mes: el dato del panel depende de que cada reserva tenga marcado
 * su documento, y casi ninguna lo tiene. Ojo que mezcla dos calendarios: los ingresos van
 * por fecha del servicio y el IVA del SII por fecha de emisión del documento. Para mirar
 * márgenes mes a mes es mejor aproximación que descontar cero; no es la cifra del contador.
 */
export async function getMonthlyIncomeStatement(rawMonths: unknown): Promise<MonthlyIncomeStatement> {
  const count = Math.min(12, Math.max(1, Math.round(Number(rawMonths)) || 6))
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date())
  const [year, month] = today.split('-').map(Number)
  const periods: string[] = []
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(year, month - 1 - i, 1))
    periods.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`)
  }

  const months = await Promise.all(
    periods.map(async (period): Promise<MonthlyStatement> => {
      const [y, m] = period.split('-').map(Number)
      const from = `${period}-01`
      const to = `${period}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`
      const [base, iva] = await Promise.all([getIncomeStatement(from, to), getIvaMonth(period).catch(() => null)])
      const sii = iva && iva.configured && !iva.error ? { debit: iva.debit, credit: iva.credit, result: iva.result, complete: iva.complete } : null

      // Con el SII a la vista, su débito reemplaza al del panel y se recalcula hacia abajo.
      const useSii = sii !== null && sii.debit > 0
      const ivaDebito = useSii ? sii!.debit : base.ivaDebito
      const netRevenue = base.grossRevenue - ivaDebito
      const grossMargin = netRevenue - base.workerPay - base.fieldExpenses
      const result = grossMargin - base.companyExpensesTotal
      const pct = (value: number) => (netRevenue > 0 ? Math.round((value / netRevenue) * 1000) / 10 : null)
      return {
        period,
        inProgress: period === today.slice(0, 7),
        statement: { ...base, ivaDebito, netRevenue, grossMargin, result, margin: pct(result) },
        ivaSource: useSii ? 'sii' : 'panel',
        sii,
        serviceMargin: pct(grossMargin),
      }
    })
  )

  const { categories } = await getExpenseCategories()
  const used = new Set(months.flatMap((mo) => mo.statement.companyExpenses.map((c) => c.category)))
  const labelOf = new Map(months.flatMap((mo) => mo.statement.companyExpenses.map((c) => [c.category, c.label] as const)))
  const ordered = [...categories.map((c) => c.value).filter((code) => used.has(code)), ...Array.from(used).filter((code) => !categories.some((c) => c.value === code))]
  return { months, categories: ordered.map((category) => ({ category, label: labelOf.get(category) || category })) }
}
