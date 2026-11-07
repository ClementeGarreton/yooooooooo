// Tipos del pago a trabajadores, SIN dependencias de servidor.

export type PayMode = 'fijo' | 'porcentaje' | 'm3km'

/** Cómo se calcula lo que gana alguien por un trabajo. */
export interface PayRule {
  mode: PayMode
  /** Pesos por trabajo (fijo) o porcentaje del valor del servicio. 0 en 'm3km'. */
  value: number
  /** Solo 'm3km': pesos por m³ trasladado y por km recorrido. */
  perM3?: number
  perKm?: number
}

export interface PayConfig {
  /** false = falta correr add_worker_pay_config.sql. */
  available: boolean
  /** false = falta correr add_worker_pay_m3km.sql (m³/km y bonificaciones). */
  m3kmAvailable: boolean
  mode: PayMode
  /** null = todavía no se definió. */
  value: number | null
  perM3: number | null
  perKm: number | null
  /** false = falta correr add_nomina_y_pago_por_trabajo.sql (pallets, fuera de Santiago, monto por trabajo, nómina). */
  jobPayAvailable: boolean
  /** Pesos por pallet entregado. null = sin definir. */
  perPallet: number | null
  /** Máximo de pallets pagados por dirección de entrega (Tomás: 4). null = sin tope. */
  maxPalletsPerAddress: number | null
  /** Mínimo por trabajo en el pago por m³, para todos (add_pago_minimo_general.sql). null = sin mínimo. */
  minJob: number | null
  /** false = falta add_pago_minimo_general.sql. */
  minJobAvailable: boolean
  /** m³ mínimos con que se paga un trabajo por m³ (add_pendientes_oct.sql). null = sin mínimo. */
  minM3: number | null
  /** false = falta add_pendientes_oct.sql. */
  minM3Available: boolean
  /** % de retención de la boleta de honorarios (add_honorarios.sql). */
  honorariosRate: number
  /** false = falta add_honorarios.sql: la tasa no se puede cambiar. */
  honorariosConfigAvailable: boolean
  /** La cuenta de la empresa desde la que sale la nómina del banco. */
  originAccountType: BankAccountType | null
  originAccountNumber: string | null
}

export type BankAccountType = 'CCT' | 'CTV'
export const BANK_ACCOUNT_TYPES: { value: BankAccountType; label: string }[] = [
  { value: 'CCT', label: 'Cuenta corriente' },
  { value: 'CTV', label: 'Cuenta vista / Cuenta RUT' },
]

/**
 * Códigos de banco que trae la plantilla de nómina del banco (ARCHIVOEJEMPLO). Los nombres
 * son los habituales de esos códigos y hay que confirmarlos contra el instructivo del banco;
 * si falta uno, en la ficha se puede escribir el código a mano.
 */
export const BANKS: { code: number; name: string }[] = [
  { code: 1, name: 'Banco de Chile / Edwards' },
  { code: 9, name: 'Banco Internacional' },
  { code: 12, name: 'BancoEstado' },
  { code: 14, name: 'Scotiabank' },
  { code: 16, name: 'BCI / Mach' },
  { code: 27, name: 'Itaú Corpbanca' },
  { code: 28, name: 'BICE' },
  { code: 31, name: 'HSBC' },
  { code: 37, name: 'Santander' },
  { code: 39, name: 'Itaú' },
  { code: 45, name: 'MUFG' },
  { code: 49, name: 'Security' },
  { code: 51, name: 'Falabella' },
  { code: 55, name: 'Consorcio' },
  { code: 504, name: 'Scotiabank Azul (ex BBVA)' },
  { code: 672, name: 'Coopeuch' },
  { code: 729, name: 'Los Héroes' },
  // Estos dos no vienen en la plantilla del banco: son los códigos que usan los proveedores
  // de transferencias (Tomás, 27-10-2026: los trabajadores no los encontraban).
  { code: 730, name: 'Tenpo' },
  { code: 875, name: 'Mercado Pago' },
]
export const bankName = (code: number | null) => (code === null ? '' : BANKS.find((b) => b.code === code)?.name || `Banco ${code}`)

const pesos = (n: number) => `$${Math.round(n).toLocaleString('es-CL')}`

/** La regla general como `PayRule`, o null si todavía no tiene valores. */
export function configRule(config: PayConfig): PayRule | null {
  if (config.mode === 'm3km') {
    if (config.perM3 === null && config.perKm === null) return null
    return { mode: 'm3km', value: 0, perM3: config.perM3 || 0, perKm: config.perKm || 0 }
  }
  return config.value !== null ? { mode: config.mode, value: config.value } : null
}

/** «$25.000 por trabajo», «8 % del servicio» o «$3.000 por m³ + $400 por km». */
export function payRuleLabel(rule: PayRule | null): string {
  if (!rule) return 'Sin definir'
  if (rule.mode === 'm3km') return `${pesos(rule.perM3 || 0)} por m³ + ${pesos(rule.perKm || 0)} por km`
  return rule.mode === 'fijo'
    ? `${pesos(rule.value)} por trabajo`
    : `${rule.value.toLocaleString('es-CL', { maximumFractionDigits: 2 })} % del servicio`
}

/** Lo que paga un trabajo con esta regla. En 'm3km' usa los m³ y km del trabajo (0 si faltan). */
export function payForJob(rule: PayRule | null, servicePrice: number, volumeM3?: number | null, distanceKm?: number | null): number | null {
  if (!rule) return null
  if (rule.mode === 'm3km') return Math.round((volumeM3 || 0) * (rule.perM3 || 0) + (distanceKm || 0) * (rule.perKm || 0))
  return rule.mode === 'fijo' ? Math.round(rule.value) : Math.round((servicePrice * rule.value) / 100)
}

/** Cómo se paga a una persona un trabajo: según su regla, un monto escrito a mano, o por pallets. */
export type JobPayMode = 'regla' | 'fijo' | 'pallets'

const n1 = (n: number) => n.toLocaleString('es-CL', { maximumFractionDigits: 1 })

/**
 * Lo que gana una persona por un trabajo y cómo se llegó a ese número.
 *
 * - 'fijo': el monto escrito a mano para ese trabajo.
 * - 'pallets': pallets del trabajo × pesos por pallet.
 * - 'regla': la regla de la persona. Por m³ y km: los m³ × tarifa, con el mínimo por trabajo
 *   de la persona si los m³ dan menos; los km × tarifa se suman solo si el trabajo es fuera de
 *   Santiago (`outsideSantiago` null = sin la migración: los km se suman siempre, como antes).
 *
 * `missing` = falta un dato (m³, km, pallets o tarifa), así que paga de menos.
 */
export function jobPay(input: {
  mode: JobPayMode
  rule: PayRule | null
  servicePrice: number
  volumeM3: number | null
  distanceKm: number | null
  outsideSantiago: boolean | null
  minPerJob: number | null
  /** m³ mínimos que se pagan (Tomás, 21-10-2026). null = sin mínimo. */
  minM3?: number | null
  fixedAmount: number | null
  pallets: number | null
  perPallet: number | null
  /** Pallets pagables como máximo en este trabajo: el tope por dirección × direcciones de entrega. null = sin tope. */
  palletCap?: number | null
}): { amount: number | null; basis: string; missing: boolean } {
  if (input.mode === 'fijo') {
    return input.fixedAmount === null ? { amount: null, basis: 'Monto a mano sin escribir', missing: true } : { amount: Math.round(input.fixedAmount), basis: 'Monto a mano', missing: false }
  }
  if (input.mode === 'pallets') {
    const missing = input.pallets === null || input.perPallet === null
    const capped = input.palletCap != null && (input.pallets || 0) > input.palletCap
    const paid = capped ? (input.palletCap as number) : input.pallets || 0
    const amount = Math.round(paid * (input.perPallet || 0))
    return {
      amount,
      basis: `${input.pallets === null ? 'sin pallets' : `${n1(input.pallets)} pallets`}${capped ? ` (se pagan ${n1(paid)}: tope por dirección)` : ''} × ${input.perPallet === null ? 'tarifa sin definir' : pesos(input.perPallet)}`,
      missing,
    }
  }
  const rule = input.rule
  if (!rule) return { amount: null, basis: 'Sin regla', missing: false }
  if (rule.mode !== 'm3km') {
    return { amount: payForJob(rule, input.servicePrice), basis: rule.mode === 'fijo' ? 'Monto fijo por trabajo' : `${n1(rule.value)} % de ${pesos(input.servicePrice)}`, missing: false }
  }
  const perM3 = rule.perM3 || 0
  const perKm = rule.perKm || 0
  // Mínimo de m³: un trabajo con menos (o sin m³) se paga como si tuviera el mínimo.
  const m3Floor = perM3 > 0 && input.minM3 && input.minM3 > (input.volumeM3 || 0) ? input.minM3 : null
  const paidM3 = m3Floor ?? input.volumeM3 ?? 0
  const byM3 = Math.round(paidM3 * perM3)
  const min = perM3 > 0 && input.minPerJob && input.minPerJob > byM3 ? input.minPerJob : null
  const countKm = perKm > 0 && input.outsideSantiago !== false
  const byKm = countKm ? Math.round((input.distanceKm || 0) * perKm) : 0
  const parts: string[] = []
  if (perM3 > 0) {
    const m3Text = input.volumeM3 === null ? 'sin m³' : `${n1(input.volumeM3)} m³`
    parts.push(`${m3Floor !== null ? `${m3Text} → mínimo ${n1(m3Floor)} m³` : m3Text} × ${pesos(perM3)}${min !== null ? ` → mínimo ${pesos(min)}` : ''}`)
  }
  if (countKm) parts.push(`${input.distanceKm === null ? 'sin km' : `${n1(input.distanceKm)} km`} × ${pesos(perKm)}`)
  return {
    amount: (min ?? byM3) + byKm,
    basis: (parts.join(' + ') || 'Sin tarifas') + (perKm > 0 && !countKm ? ' · en Santiago, sin km' : ''),
    missing: (perM3 > 0 && input.volumeM3 === null && min === null && m3Floor === null) || (countKm && input.distanceKm === null),
  }
}

export interface WorkerPayJob {
  id: string
  code: string | null
  date: string
  clientName: string
  via: 'cuadrilla' | 'camion'
  /** Valor del servicio (con IVA), la base del porcentaje. */
  servicePrice: number
  /** m³ y km del trabajo (puestos a mano en la reserva o, si no, los de la cotización). */
  volumeM3: number | null
  distanceKm: number | null
  /** Fuera de Santiago: solo entonces suman los km. null = sin la migración (suman siempre). */
  outsideSantiago: boolean | null
  /** Pallets entregados en el trabajo. */
  pallets: number | null
  /** Cómo se le paga ESTE trabajo a esta persona, y el monto a mano si es 'fijo'. */
  payMode: JobPayMode
  fixedAmount: number | null
  /** Cómo se llegó al monto, para mostrarlo («12 m³ × $2.000 + 40 km × $300»). */
  basis: string
  /**
   * Lo que le corresponde por este trabajo. null si no hay regla. Si ya se pagó, es el monto
   * que quedó guardado en ese pago, aunque después cambie la regla o el trabajo.
   */
  amount: number | null
  /** Si ya entró en un pago registrado, cuándo. null = pendiente de pago. */
  paidAt: string | null
}

/** Tipos de cosa que se puede pagar. `ref` identifica cada una dentro de su tipo. */
export type PayItemKind = 'trabajo' | 'gasto' | 'ajuste' | 'base'

/**
 * Una cosa pagable de un funcionario en el período: lo que se marca o desmarca al registrar
 * un pago. `ref` = id de la reserva, del gasto o del ajuste; en el sueldo base, el mes
 * ('YYYY-MM').
 */
/**
 * Cómo se calcula cada cosa que se le paga, para desglosar el pago (Tomás, 20-10-2026): hay
 * trabajos fijos y otros con cálculo variable, y se pueden pagar por separado.
 */
export type PayGroup = 'variable' | 'fijo' | 'porcentaje' | 'pallets' | 'base' | 'ajuste' | 'gasto'

export const PAY_GROUP_LABEL: Record<PayGroup, string> = {
  variable: 'Variable (m³ y km)',
  fijo: 'Monto fijo',
  porcentaje: 'Porcentaje del servicio',
  pallets: 'Por pallets',
  base: 'Sueldo base',
  ajuste: 'Bonos y descuentos',
  gasto: 'Gastos por devolver',
}

export const PAY_GROUP_ORDER: PayGroup[] = ['fijo', 'variable', 'porcentaje', 'pallets', 'base', 'ajuste', 'gasto']

/** Grupo de un trabajo según cómo se le paga: a mano, por pallets o según su regla. */
export function jobGroup(payMode: JobPayMode, rule: PayRule | null): PayGroup {
  if (payMode === 'fijo') return 'fijo'
  if (payMode === 'pallets') return 'pallets'
  return rule?.mode === 'm3km' ? 'variable' : rule?.mode === 'porcentaje' ? 'porcentaje' : 'fijo'
}

export interface PayItem {
  kind: PayItemKind
  /** Cómo se calcula: para desglosar el pago y pagar por grupos. */
  group: PayGroup
  ref: string
  date: string
  label: string
  detail: string
  amount: number
  paidAt: string | null
}

export interface WorkerPayRow {
  workerId: string
  name: string
  code: string
  active: boolean
  rut: string | null
  email: string | null
  /** Datos para la nómina del banco. */
  bank: { code: number | null; accountType: BankAccountType | null; accountNumber: string | null }
  /** Mínimo por trabajo cuando se le paga por m³. null = sin mínimo. */
  minPerJob: number | null
  /** % de retención de su boleta (la tasa de Configuración). null = no emite boleta. */
  honorariosRate: number | null
  /**
   * Retención de la boleta sobre lo que falta pagar (`pending`). Los montos del panel son el
   * LÍQUIDO pactado: la retención va ENCIMA y la paga la empresa al SII (costo adicional).
   */
  retentionPending: number
  /** Retención sobre todo lo del período (`due`). */
  retentionDue: number
  /** Regla que se le aplica, y si es la suya o la general. */
  rule: PayRule | null
  ruleSource: 'propia' | 'general' | null
  jobs: WorkerPayJob[]
  /** Suma de lo que le corresponde por sus trabajos. null si no tiene regla. */
  jobsDue: number | null
  /**
   * Gastos aprobados del período. `owed` = hay que devolvérselo: lo pagó de su bolsillo
   * (contado) y no se le reembolsó aparte. Los pagados a crédito con medios de la empresa y
   * los ya reembolsados se listan igual, para que el cierre los muestre, pero no suman.
   */
  expenses: WorkerPayExpense[]
  /** Suma de los `owed`. */
  expensesTotal: number
  /** Bonificaciones y ajustes cargados a mano en el período (un ajuste en contra es negativo). */
  bonuses: { id: string; amount: number; date: string; note: string | null; createdBy: string | null; paidAt: string | null }[]
  bonusTotal: number
  /** Sueldo base mensual. null = no tiene base. */
  basePay: number | null
  /** El sueldo base de cada mes que toca el período: se paga una vez por mes. */
  baseMonths: { month: string; amount: number; paidAt: string | null }[]
  baseTotal: number
  /** Todo lo pagable del período, pagado o no: trabajos, gastos por devolver, ajustes y base. */
  items: PayItem[]
  /** Lo que falta pagar: la suma de los ítems sin pago. */
  pending: number
  /** Trabajos + gastos por devolver + bonificaciones y ajustes. null si no hay regla ni nada más que pagar. */
  due: number | null
  /** Cierre vigente de EXACTAMENTE este período, si lo hay. */
  closing: PayClosing | null
  /** true = alguna fecha del período cae en un cierre vigente: no se pueden tocar sus ajustes. */
  locked: boolean
  /** Pagos registrados cuyo período cae dentro del rango. */
  paid: number
  payments: {
    id: string
    amount: number
    jobs: number
    from: string
    to: string
    paidAt: string
    method: string | null
    note: string | null
    createdBy: string | null
    /** Qué se pagó. Vacío en los pagos registrados antes de que existiera el detalle. */
    items: { kind: PayItemKind; label: string; amount: number }[]
  }[]
}

export type ExpensePayment = 'contado' | 'credito'

export interface WorkerPayExpense {
  id: string
  /** Trabajo al que pertenece el gasto, si se rindió en uno. */
  bookingId: string | null
  name: string
  amount: number
  date: string
  payment: ExpensePayment
  reimbursed: boolean
  owed: boolean
  /** Reembolsado dentro de un pago registrado, cuándo. */
  paidAt: string | null
}

/** Una línea del detalle de pago de un funcionario. */
export interface PayStatementLine {
  date: string
  kind: PayItemKind
  label: string
  detail: string
  /** Lo que suma al pago. 0 en un gasto que no se le debe (crédito o ya reembolsado). */
  amount: number
}

/** El detalle de pago de un funcionario en un período: lo que se descarga y lo que se cierra. */
export interface PayStatement {
  workerId: string
  name: string
  code: string
  from: string
  to: string
  ruleLabel: string
  lines: PayStatementLine[]
  jobsCount: number
  jobsTotal: number
  expensesTotal: number
  adjustmentsTotal: number
  /** Sueldo base de los meses del período. Ausente en los cierres guardados antes de oct-2026. */
  baseTotal?: number
  total: number
}

export interface PayClosing {
  id: string
  closedBy: string | null
  closedAt: string
  /** Glosa que acompaña el detalle. */
  note: string | null
  /** El detalle tal como quedó al cerrar: no cambia aunque después se edite una reserva. */
  statement: PayStatement
}

const MONTH_NAMES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
/** «octubre 2026» a partir de 'YYYY-MM'. */
export const monthName = (month: string) => `${MONTH_NAMES[Number(month.slice(5, 7)) - 1] || month} ${month.slice(0, 4)}`

export const PAY_ITEM_LABEL: Record<PayItemKind, string> = { trabajo: 'Trabajo', gasto: 'Gasto', ajuste: 'Ajuste', base: 'Sueldo base' }

const expenseDetail = (e: WorkerPayExpense) =>
  e.payment === 'credito' ? 'Crédito (pagado por la empresa)' : e.reimbursed && !e.owed ? 'Contado · ya reembolsado' : 'Contado · por reembolsar'

/** Arma el detalle de pago de una fila. Pura: la usan el servidor (al cerrar) y la pantalla. */
export function buildPayStatement(row: WorkerPayRow, from: string, to: string): PayStatement {
  const lines: PayStatementLine[] = [
    ...row.jobs.map(
      (j): PayStatementLine => ({
        date: j.date,
        kind: 'trabajo',
        label: [j.code, j.clientName].filter(Boolean).join(' · ') || 'Trabajo',
        detail: j.basis,
        amount: j.amount || 0,
      })
    ),
    ...row.expenses.map((e): PayStatementLine => ({ date: e.date, kind: 'gasto', label: e.name, detail: expenseDetail(e), amount: e.owed ? e.amount : 0 })),
    ...row.bonuses.map(
      (b): PayStatementLine => ({ date: b.date, kind: 'ajuste', label: b.amount < 0 ? 'Descuento' : 'Bonificación', detail: b.note || '', amount: b.amount })
    ),
    ...row.baseMonths.map((b): PayStatementLine => ({ date: `${b.month}-01`, kind: 'base', label: `Sueldo base ${monthName(b.month)}`, detail: '', amount: b.amount })),
  ].sort((a, b) => a.date.localeCompare(b.date))
  const jobsTotal = row.jobsDue || 0
  return {
    workerId: row.workerId,
    name: row.name,
    code: row.code,
    from,
    to,
    ruleLabel: payRuleLabel(row.rule),
    lines,
    jobsCount: row.jobs.length,
    jobsTotal,
    expensesTotal: row.expensesTotal,
    adjustmentsTotal: row.bonusTotal,
    baseTotal: row.baseTotal,
    total: jobsTotal + row.expensesTotal + row.bonusTotal + row.baseTotal,
  }
}

export interface WorkerPayData {
  from: string
  to: string
  /** false = falta correr add_worker_pay.sql. */
  available: boolean
  config: PayConfig
  rows: WorkerPayRow[]
  totalJobs: number
  totalDue: number
  totalPaid: number
  /** Trabajos del período en los que no hay nadie asignado. */
  unassignedJobs: number
  /** Con regla por m³/km: trabajos sin m³ o sin km, que por eso pagan de menos. */
  jobsMissingData: number
  /** false = falta correr add_pay_closings.sql: no se puede cerrar ni marcar reembolsos. */
  closingsAvailable: boolean
  /** false = falta correr add_payment_items.sql: sin detalle por pago ni sueldo base. */
  itemsAvailable: boolean
  /** false = falta correr add_nomina_y_pago_por_trabajo.sql: sin monto por trabajo, pallets, fuera de Santiago ni nómina. */
  jobPayAvailable: boolean
  /** false = falta correr add_honorarios.sql: sin boleta de honorarios ni retención. */
  honorariosAvailable: boolean
}

/** Tasa de retención de 2026 (Tomás, 19-10-2026). Sube a 16 % en 2027 y 17 % en 2028: se cambia en Configuración. */
export const DEFAULT_HONORARIOS_RATE = 15.25

/** Boleta por el bruto: líquido ÷ (1 − tasa). Ej.: $100.000 al 15,25 % → $117.994. */
export function honorariosGross(net: number, rate: number): number {
  return Math.round(net / (1 - rate / 100))
}

/**
 * Retención de la boleta sobre unos ítems de pago (Tomás, 19-10-2026): con el funcionario se
 * pacta el líquido, la boleta se hace por el bruto y la diferencia la paga la empresa al SII.
 * Va ENCIMA de lo que se le paga. Solo sobre lo que es honorario (trabajos, sueldo base,
 * bonificaciones y descuentos): los gastos que se le devuelven no.
 */
export function honorariosRetention(items: { kind: PayItemKind; amount: number }[], rate: number | null): number {
  if (!rate) return 0
  const net = items.filter((i) => i.kind !== 'gasto').reduce((sum, i) => sum + i.amount, 0)
  return net > 0 ? honorariosGross(net, rate) - net : 0
}

/** Las 13 columnas de la nómina del banco, en el orden y con los títulos de su plantilla. */
export const BANK_PAYROLL_HEADERS = [
  'Tipo de Cuenta Origen',
  ' Cuenta Origen',
  ' Codigo Banco Destino',
  ' Tipo de Cuenta Destino',
  ' Cuenta Destino',
  ' Rut Beneficiario',
  ' Nombre Beneficiario',
  ' Monto Transferencia',
  ' Concepto',
  ' Mensaje a Beneficiario',
  'Email 1',
  'Email 2',
  'Email 3',
] as const

/**
 * Encabezado de la nómina en CSV, igual al ejemplo que mandó Tomás de BancoEstado
 * («ARCHIVOEJEMPLO (1).csv», 21-10-2026): separado por «;», ASCII y saltos de línea LF.
 */
export const BANK_PAYROLL_CSV_HEADER =
  'Tipo de Cuenta Origen; Cuenta Origen; Codigo Banco Destino; Tipo de Cuenta Destino; Cuenta Destino; Rut Beneficiario; Nombre Beneficiario; Monto Transferencia; Concepto; Mensaje a Beneficiario; Email 1;Email 2;Email 3'

/** Una fila de la nómina como línea del CSV: sin «;» ni saltos dentro de un campo y sin tildes (ASCII). */
export function bankPayrollCsvLine(row: (string | number | null)[]): string {
  return row
    .map((cell) =>
      cell === null || cell === undefined
        ? ''
        : String(cell)
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^\x20-\x7E]/g, '')
            .replace(/;/g, ',')
            .trim()
    )
    .join(';')
}

/** Qué le falta a un funcionario para entrar en la nómina del banco. Vacío = está completo. */
export function bankDataMissing(row: Pick<WorkerPayRow, 'rut' | 'bank'>): string[] {
  const missing: string[] = []
  if (!row.rut) missing.push('RUT')
  if (row.bank.code === null) missing.push('banco')
  if (!row.bank.accountType) missing.push('tipo de cuenta')
  if (!row.bank.accountNumber) missing.push('número de cuenta')
  return missing
}
