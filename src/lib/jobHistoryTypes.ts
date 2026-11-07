// Historial de trabajos del admin. SIN dependencias de servidor.

import type { JobWorkStatus } from '@/lib/adminJobsTypes'

export interface JobHistoryRow {
  id: string
  /** El ID del trabajo: el código de la reserva (RES-000123). */
  code: string | null
  /** Con esto abre la pestaña Reservas. */
  quoteId: string | null
  date: string
  time: string | null
  clientName: string
  clientPhone: string | null
  origin: string
  destination: string
  status: string
  vehicleId: number | null
  vehicleName: string | null
  /** Quiénes fueron: los puestos en la cuadrilla y los que tienen ese camión como habitual. */
  workers: string[]
  work: JobWorkStatus
}

export interface JobHistoryData {
  rows: JobHistoryRow[]
  /** Cuántos trabajos cumplen el filtro en total (la lista viene por páginas). */
  total: number
  page: number
  pageSize: number
  vehicles: { id: number; name: string }[]
  workers: { id: string; name: string; code: string }[]
}
