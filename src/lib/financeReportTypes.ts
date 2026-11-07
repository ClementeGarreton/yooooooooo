// Resumen financiero con filtros (Finanzas → Resumen). SIN dependencias de servidor.

export type ServiceFilter = 'todos' | 'mudanza' | 'domicilio'

export const SERVICE_FILTER_LABEL: Record<ServiceFilter, string> = { todos: 'Todos los servicios', mudanza: 'Mudanza', domicilio: 'Visita a domicilio' }

/** Cliente: '' = todos; 'empresas' / 'personas'; o uno puntual ('e:<id empresa>' o 'p:<correo>'). */
export type ClientFilter = string

export interface FinanceReportBooking {
  id: string
  code: string | null
  date: string
  client: string
  /** Clave del cliente para el filtro. */
  clientKey: string
  service: Exclude<ServiceFilter, 'todos'>
  document: 'factura' | 'boleta' | 'sin_documento' | 'sin_definir'
  /** Valor del servicio con IVA, IVA (si lleva boleta o factura) y neto. */
  total: number
  iva: number
  net: number
  /** Lo que se le paga a la cuadrilla por este trabajo. */
  workerPay: number
  /** Gastos de terreno aprobados rendidos en este trabajo. */
  fieldExpenses: number
  /** Neto − pago a trabajadores − gastos de terreno. */
  margin: number
  workers: string[]
}

export interface FinanceReportWorker {
  id: string
  name: string
  jobs: number
  /** Lo que gana por los trabajos del filtro. */
  jobsPay: number
  /** Sueldo base y bonificaciones/descuentos: solo cuando no hay filtro de servicio, cliente ni trabajador. */
  base: number
  adjustments: number
  fieldExpenses: number
  /** % de retención de honorarios, y la retención sobre su líquido (costo de la empresa). */
  honorariosRate: number | null
  retention: number
}

export interface FinanceReport {
  from: string
  to: string
  service: ServiceFilter
  client: ClientFilter
  workerId: string
  /** true = hay filtro de servicio, cliente o trabajador: los gastos de la empresa, sueldos base y bonificaciones no se reparten y quedan fuera. */
  filtered: boolean
  income: { services: number; gross: number; ivaDebito: number; net: number; undefinedDocCount: number }
  /** `retention` = retención de las boletas de honorarios: la paga la empresa encima del líquido. */
  costs: { workerPay: number; base: number; adjustments: number; retention: number; fieldExpenses: number; total: number }
  companyExpenses: { label: string; net: number }[]
  companyExpensesTotal: number
  taxes: { ivaDebito: number; ivaCredito: number; ivaToPay: number; honorariosRetention: number }
  /** Ingresos netos − costos − gastos de la empresa. */
  result: number
  /** Utilidad sobre ingresos netos, en %. null sin ingresos. */
  margin: number | null
  bookings: FinanceReportBooking[]
  workers: FinanceReportWorker[]
  expenses: { date: string; category: string; description: string; provider: string | null; docNumber: string | null; amount: number; iva: number; net: number }[]
  fieldExpenseList: { date: string; worker: string; name: string; amount: number; bookingCode: string | null }[]
  /** Para armar los filtros: los clientes y trabajadores con algo en el período. */
  options: { clients: { value: string; label: string }[]; workers: { id: string; name: string }[] }
  /** Avisos sobre lo que el resumen no cubre. */
  notes: string[]
}
