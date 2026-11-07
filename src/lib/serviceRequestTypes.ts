// Tipos y textos de las solicitudes de servicio, SIN dependencias de servidor: los usan
// componentes cliente (el formulario del panel, la bandeja del admin). Lo que toca la base
// vive en serviceRequests.ts.

export type ServiceType = 'mudanza' | 'transporte' | 'carga' | 'pallets'
export type ServiceRequestStatus = 'pendiente' | 'aprobada' | 'rechazada'

export const SERVICE_TYPES: { value: ServiceType; label: string; hint: string }[] = [
  { value: 'mudanza', label: 'Mudanza', hint: 'Hogar u oficina' },
  { value: 'transporte', label: 'Transporte', hint: 'Traslado programado' },
  { value: 'carga', label: 'Carga', hint: 'Mercadería o materiales' },
  // Servicio de pallets (Tomás, 20-10-2026). Necesita add_servicio_pallets.sql.
  { value: 'pallets', label: 'Pallets', hint: 'Retiro y entrega de pallets' },
]

export const SERVICE_TYPE_LABEL: Record<ServiceType, string> = {
  mudanza: 'Mudanza',
  transporte: 'Transporte',
  carga: 'Carga',
  pallets: 'Pallets',
}

/** Horas de anticipación bajo las cuales un servicio va con tarifa prioritaria (Tomás, 20-10-2026). */
export const PRIORITY_HOURS = 24

/**
 * ¿El servicio pedido empieza en menos de 24 h? Fecha y hora son de Chile. Sin hora, se toma
 * el comienzo del día: un servicio para mañana sin hora puede ser a primera hora.
 */
export function isPriorityRequest(date: string, time: string | null, now: Date = new Date()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false
  const hhmm = time && /^\d{2}:\d{2}/.test(time) ? time.slice(0, 5) : '00:00'
  // Desfase de Chile en esa fecha (−3 o −4 según el horario de verano).
  const probe = new Date(`${date}T12:00:00Z`)
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Santiago', hour: '2-digit', hourCycle: 'h23' }).formatToParts(probe)
  const chileNoon = Number(parts.find((p) => p.type === 'hour')?.value ?? 12)
  const offsetHours = chileNoon - 12
  const start = Date.parse(`${date}T${hhmm}:00Z`) - offsetHours * 3_600_000
  return start - now.getTime() < PRIORITY_HOURS * 3_600_000
}

/** Un paso del seguimiento de una solicitud, del envío al cierre. */
export interface RequestStep {
  key: 'enviada' | 'aprobada' | 'rechazada' | 'asignada' | 'realizada' | 'cancelada'
  label: string
  done: boolean
  /** Fecha y hora ISO en que pasó, si se sabe. */
  at: string | null
  /** Quién lo hizo. En el panel del cliente no se muestran los usuarios internos. */
  by: string | null
  detail?: string | null
}

export interface ServiceRequestView {
  id: string
  code: string
  serviceType: ServiceType
  origin: string
  destination: string
  requestedDate: string
  requestedTime: string | null
  contact: string | null
  description: string
  /** m³ y personas que pidió. Obligatorios en las solicitudes de empresa desde oct-2026. */
  volumeM3: number | null
  peopleNeeded: number | null
  /** Solo en «Pallets»: cuántos pidió y si repaletizar. */
  pallets: number | null
  repalletize: boolean
  /** Pedida con menos de 24 h: tarifa prioritaria, aceptada por el cliente al enviarla. */
  isPriority: boolean
  priorityAcceptedAt: string | null
  /** El retiro o la entrega tiene hora fija (add_pendientes_oct.sql). */
  fixedTime: boolean
  status: ServiceRequestStatus
  rejectionReason: string | null
  createdAt: string
  customer: { id: string; code: string; name: string | null; email: string; phone: string | null }
  company: { id: string; code: string; razon_social: string; rut: string } | null
  /** `quoteId` es por lo que busca la pestaña Reservas del admin. */
  booking: { id: string; code: string | null; quoteId: string | null; status: string | null } | null
  steps: RequestStep[]
}
