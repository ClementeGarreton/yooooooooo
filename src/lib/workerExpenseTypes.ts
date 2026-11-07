// Tipos de los gastos de trabajadores, SIN dependencias de servidor.

export type ExpenseStatus = 'pendiente' | 'aprobado' | 'rechazado'

export const EXPENSE_STATUS_LABEL: Record<ExpenseStatus, string> = {
  pendiente: 'Por aprobar',
  aprobado: 'Aprobado',
  rechazado: 'Rechazado',
}

export interface WorkerExpense {
  id: string
  /** Nombre del gasto (peaje, bencina…). */
  name: string
  amount: number
  /** N° de la boleta o factura. null en los gastos anteriores a oct-2026. */
  docNumber: string | null
  /** Otro gasto (no rechazado) tiene el mismo N°: posible comprobante repetido. */
  duplicateNumber: boolean
  /** Cómo se pagó. Los gastos anteriores a oct-2026 no lo traen: se tratan como contado. */
  payment: 'contado' | 'credito'
  /** Solo contado: si ya se le devolvió la plata al trabajador. */
  reimbursed: boolean
  /** Quedó reembolsado por un cierre de pagos: se cambia reabriendo el cierre, no acá. */
  reimbursedByClosing: boolean
  status: ExpenseStatus
  workerLabel: string
  createdAt: string
  reviewedBy: string | null
  reviewedAt: string | null
  rejectReason: string | null
  booking: { id: string; code: string | null; quoteId: string | null; clientName: string; date: string | null } | null
}

/** Una foto o documento que subió un trabajador sin marcarlo como gasto (sin monto). */
export interface LooseUpload {
  id: string
  kind: 'foto' | 'documento'
  note: string | null
  fileName: string | null
  workerLabel: string
  createdAt: string
  booking: { code: string | null; quoteId: string | null; clientName: string; date: string | null } | null
}

export interface WorkerExpensesData {
  /** Fotos y documentos de trabajadores que no son gasto: se pueden pasar a gasto con su monto. */
  loose: LooseUpload[]
  expenses: WorkerExpense[]
  pending: number
  pendingTotal: number
}
