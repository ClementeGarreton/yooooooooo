// Tipos del panel de Finanzas, SIN dependencias de servidor (los usa el componente). Lo
// que toca la base vive en finance.ts.

import type { InvoiceStatus } from '@/lib/invoiceTypes'

export interface FinanceBooking {
  id: string
  code: string | null
  quoteId: string | null
  scheduledDate: string | null
  status: string | null
  clientName: string | null
  /** Empresa a la que se le factura, si la reserva está asignada a una. */
  company: { id: string; razon_social: string } | null
  /** Precio original cotizado (con IVA). */
  quoted: number
  /** Ajustes aprobados: total − cotizado. */
  adjustments: number
  total: number
  paid: number
  pending: number
  /** boleta | factura | sin_documento | null (sin definir). */
  taxDocument: string | null
  invoice: { status: InvoiceStatus; folio: string | null } | null
}

export interface FinanceCompany {
  id: string
  code: string
  razon_social: string
  /** Reservas del mes sin facturar, y cuántas de esas ya están completadas. */
  unbilledCount: number
  unbilledTotal: number
  completedUnbilledCount: number
  invoicedTotal: number
}

export interface FinanceInvoice {
  id: string
  company: string
  status: InvoiceStatus
  folio: string | null
  total: number | null
  fechaEmision: string | null
  emittedBy: string | null
}

/** Los servicios del mes agrupados por el documento tributario que llevan. */
export interface FinanceDocumentRow {
  key: 'factura' | 'boleta' | 'sin_documento' | 'sin_definir'
  label: string
  count: number
  /** Valor de los servicios, con IVA. */
  total: number
  paid: number
  pending: number
  /** Solo factura y boleta: total / 1,19 y la diferencia. En las otras dos filas van en 0. */
  net: number
  iva: number
}

export interface FinanceData {
  /** Mes 'YYYY-MM' (el del final del rango, si se pidió un rango). */
  period: string
  /** Días que cubre, por fecha del servicio. */
  from: string
  to: string
  summary: {
    /** Valor de lo reservado en el mes (con IVA). */
    booked: number
    paid: number
    paidCount: number
    pending: number
    pendingCount: number
    paidByChannel: { flow: number; transfer: number; cash: number; otro: number }
    /** Total de las facturas emitidas en el período. */
    invoiced: number
    invoicedCount: number
  }
  /** Ingresos con y sin documento tributario, y el IVA de los que sí llevan. */
  byDocument: FinanceDocumentRow[]
  /** IVA débito del mes: el de los servicios con factura o boleta. */
  ivaDebito: number
  withDocumentTotal: number
  withoutDocumentTotal: number
  bookings: FinanceBooking[]
  companies: FinanceCompany[]
  invoices: FinanceInvoice[]
  /** false = falta correr add_invoices.sql. */
  invoicesAvailable: boolean
  /** false = faltan EMISSO_CONNECT_API_KEY / EMISSO_CONNECTION_ID en el servidor. */
  emissoConfigured: boolean
}
