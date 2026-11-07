// Tipos de la facturación mensual, SIN dependencias de servidor (los usa la ficha de
// empresa del admin). Lo que toca la base y Emisso vive en invoicing.ts.

export type InvoiceStatus = 'previsualizada' | 'emitiendo' | 'emitida' | 'rechazada' | 'fallida' | 'desconocido'

export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  previsualizada: 'Vista previa',
  emitiendo: 'Emitiendo',
  emitida: 'Emitida',
  rechazada: 'Rechazada por el SII',
  fallida: 'No se emitió',
  desconocido: 'Resultado desconocido',
}

/** Una reserva de la empresa en un mes, con lo que se le facturaría. Montos con IVA. */
export interface BillableBooking {
  id: string
  code: string | null
  scheduledDate: string | null
  status: string | null
  clientName: string | null
  /** Precio original cotizado. */
  quoted: number
  /** Ajustes aprobados (reajustes y modificaciones en terreno): total − cotizado. */
  adjustments: number
  total: number
  paid: number
  /** Folio (o estado) de la factura que ya la cubre; null = sin facturar. */
  invoiced: { invoiceId: string; status: InvoiceStatus; folio: string | null } | null
  /**
   * Monto neto en UF puesto por el cierre de la empresa (Monfiza). Sin facturar, `total` sale
   * de esto con la UF de hoy (con IVA): los pesos se fijan al emitir la factura.
   */
  priceUf?: number | null
  /** UF con que se calculó `total`, si la reserva está en UF. */
  ufValue?: number | null
}

export interface InvoiceView {
  id: string
  period: string
  status: InvoiceStatus
  neto: number | null
  iva: number | null
  total: number | null
  panelTotal: number
  folio: string | null
  operacionId: string | null
  fechaEmision: string | null
  previewExpiresAt: string | null
  errorCode: string | null
  errorMessage: string | null
  detalles: { nombre: string; cantidad: number; precioUnitario: number }[]
  bookingCount: number
  createdBy: string | null
  emittedBy: string | null
  createdAt: string
}
