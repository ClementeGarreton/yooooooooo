// Gastos de la empresa y estado de resultados. SIN dependencias de servidor.

export const EXPENSE_CATEGORIES = [
  { value: 'combustible', label: 'Combustible' },
  { value: 'peajes', label: 'Peajes y estacionamiento' },
  { value: 'mantencion', label: 'Mantención de vehículos' },
  { value: 'materiales', label: 'Materiales y embalaje' },
  { value: 'sueldos', label: 'Sueldos y honorarios' },
  { value: 'arriendo', label: 'Arriendo y oficina' },
  { value: 'publicidad', label: 'Publicidad' },
  { value: 'seguros', label: 'Seguros' },
  { value: 'software', label: 'Servicios y software' },
  { value: 'impuestos', label: 'Impuestos y patentes' },
  { value: 'otros', label: 'Otros' },
] as const

/**
 * Código de una categoría: una de las de arriba o una creada en el panel
 * (`expense_categories`). Por eso es texto libre y no una unión cerrada.
 */
export type ExpenseCategory = string

export interface ExpenseCategoryOption {
  value: string
  label: string
  /** true = creada en el panel: se puede quitar de la lista. */
  custom: boolean
}

/** Nombre de una categoría, buscando en la lista vigente. Un código que ya no existe se muestra tal cual. */
export const expenseCategoryLabel = (value: string, categories: { value: string; label: string }[] = [...EXPENSE_CATEGORIES]) =>
  categories.find((c) => c.value === value)?.label || EXPENSE_CATEGORIES.find((c) => c.value === value)?.label || value || 'Sin categoría'

/** Código estable a partir del nombre: minúsculas, sin tildes, con guiones bajos. */
export function categorySlug(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
}

export interface CompanyExpense {
  id: string
  date: string
  category: ExpenseCategory
  description: string
  /** Total pagado. */
  amount: number
  /** IVA incluido en ese total (0 si no lleva o no se anotó). */
  iva: number
  provider: string | null
  docNumber: string | null
  createdBy: string | null
}

export interface ExpensesData {
  from: string
  to: string
  /** false = falta correr add_company_expenses.sql. */
  available: boolean
  expenses: CompanyExpense[]
  total: number
  totalIva: number
  byCategory: { category: ExpenseCategory; label: string; count: number; amount: number; net: number }[]
  /** Gastos rendidos por trabajadores y aprobados en el período (se aprueban en «Por aprobar»). */
  workerExpenses: { id: string; date: string; name: string; amount: number; worker: string; category: ExpenseCategory | null }[]
  workerExpensesTotal: number
  /** Las categorías vigentes: las del panel más las creadas. */
  categories: ExpenseCategoryOption[]
  /** false = falta correr add_expense_categories.sql: no se pueden crear categorías ni categorizar gastos de trabajadores. */
  categoriesAvailable: boolean
  /** Todo junto por categoría: gastos de la empresa y de trabajadores. */
  consolidated: { category: ExpenseCategory | null; label: string; company: number; workers: number; total: number }[]
  /** Cargos del banco del mes que no calzan con ningún gasto ni pago registrado. */
  bankPending: { date: string; description: string; amount: number }[]
  /** Mes del banco que se revisó ('YYYY-MM'), y si el banco entregó movimientos. */
  bankPeriod: string
  bankHasData: boolean
}

export interface IncomeStatement {
  from: string
  to: string
  /** Servicios del período por fecha del servicio (sin cancelados ni no atendidos). */
  services: number
  /** Valor de esos servicios, con IVA. */
  grossRevenue: number
  /** IVA de los servicios con boleta o factura. */
  ivaDebito: number
  netRevenue: number
  /** Servicios sin documento tributario definido: su IVA (si lo llevan) no está descontado. */
  undefinedDocCount: number
  undefinedDocTotal: number
  /** Lo que corresponde pagar por los trabajos del período, con bonificaciones. */
  workerPay: number
  workerBonuses: number
  /** true = hay trabajadores sin regla de pago: su pago no está en la cuenta. */
  workerPayIncomplete: boolean
  /** Gastos de terreno rendidos por trabajadores y aprobados. */
  fieldExpenses: number
  grossMargin: number
  /** Gastos de la empresa, netos de IVA, por categoría. */
  companyExpenses: { category: ExpenseCategory; label: string; net: number }[]
  companyExpensesTotal: number
  /** false = falta correr add_company_expenses.sql. */
  companyExpensesAvailable: boolean
  result: number
  /** Resultado sobre ingresos netos, en %. null sin ingresos. */
  margin: number | null
}

/** Un mes del estado de resultados mensual. */
export interface MonthlyStatement {
  /** 'YYYY-MM'. */
  period: string
  /** true = el mes en curso: los ingresos incluyen servicios agendados que aún no se hacen. */
  inProgress: boolean
  statement: IncomeStatement
  /**
   * De dónde sale el IVA que se descuenta de los ingresos: 'sii' = el débito del Registro de
   * Ventas del SII de ese mes; 'panel' = el de las reservas con boleta o factura marcada.
   */
  ivaSource: 'sii' | 'panel'
  /** IVA del mes según el SII (vía Emisso). null si no se pudo leer. */
  sii: { debit: number; credit: number; result: number; complete: boolean } | null
  /** Margen después de pagar el servicio, sobre ingresos netos, en %. */
  serviceMargin: number | null
}

export interface MonthlyIncomeStatement {
  months: MonthlyStatement[]
  /** Categorías de gasto que aparecen en algún mes, en el orden de la lista. */
  categories: { category: ExpenseCategory; label: string }[]
}
