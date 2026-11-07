// Tipos y textos de las modificaciones en terreno, SIN dependencias de servidor: los usan
// componentes cliente (la tarjeta del trabajador, la bandeja y el detalle del admin). Lo
// que toca la base vive en bookingModifications.ts.

export type ModificationField = 'bultos' | 'volumen' | 'horas' | 'paradas' | 'otro'
export type ModificationStatus = 'pendiente' | 'aprobada' | 'rechazada'

export const MODIFICATION_FIELDS: { value: ModificationField; label: string }[] = [
  { value: 'bultos', label: 'Bultos' },
  { value: 'volumen', label: 'Volumen (m³)' },
  { value: 'horas', label: 'Horas' },
  { value: 'paradas', label: 'Paradas' },
  { value: 'otro', label: 'Otro' },
]

export const MODIFICATION_FIELD_LABEL: Record<ModificationField, string> = {
  bultos: 'Bultos',
  volumen: 'Volumen',
  horas: 'Horas',
  paradas: 'Paradas',
  otro: 'Otro',
}

export const MODIFICATION_STATUS_LABEL: Record<ModificationStatus, string> = {
  pendiente: 'Pendiente de aprobación',
  aprobada: 'Aprobada',
  rechazada: 'Rechazada',
}

/** Una modificación tal como la ve quien la registró (sin precios). */
export interface WorkerModification {
  id: string
  bookingId: string
  field: ModificationField
  originalValue: string
  foundValue: string
  note: string
  status: ModificationStatus
  createdAt: string
}

/** Una modificación en el admin: con la reserva, quién, y el impacto en precio. */
export interface AdminModification extends WorkerModification {
  workerLabel: string
  priceDelta: number | null
  priceBefore: number | null
  priceAfter: number | null
  resolvedBy: string | null
  resolvedAt: string | null
  resolutionNote: string | null
  booking: {
    id: string
    code: string | null
    quoteId: string | null
    clientName: string | null
    scheduledDate: string | null
    scheduledTime: string | null
    origin: string | null
    destination: string | null
    /** Precio vigente del servicio (con los ajustes ya aprobados). */
    price: number
  } | null
}

/** Un hecho del historial de una reserva, para el detalle del admin. */
export interface HistoryEvent {
  at: string
  title: string
  by: string | null
  detail?: string | null
  /** 'modification' se destaca: es lo que el historial existe para mostrar. */
  kind: 'request' | 'log' | 'modification'
}
