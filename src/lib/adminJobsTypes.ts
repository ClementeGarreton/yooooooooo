// Tipos del panel «Trabajos» del admin, SIN dependencias de servidor.

import type { VehicleView } from '@/lib/vehicleAssignment'
import type { Worker } from '@/lib/workers'

export interface AdminJob {
  id: string
  code: string | null
  /** Con esto busca la pestaña Reservas. */
  quoteId: string | null
  date: string
  time: string | null
  durationHours: number | null
  clientName: string
  bookingType: string
  origin: string
  destination: string
  status: string
  vehicleId: number | null
  /** m³ del trabajo: el puesto a mano en la reserva o, si no, el de la cotización. */
  volumeM3: number | null
  /** Personas que pide: lo puesto a mano en la reserva o, si no, la cuadrilla cotizada. */
  people: number | null
  /** Trabajadores puestos a mano en la cuadrilla (ids). Los del camión habitual van aparte. */
  crew: string[]
  /** Lo que marcaron los trabajadores desde su panel (vacío si nadie inició el trabajo). */
  work: JobWork
  /** Retiro o entrega con hora fija (add_pendientes_oct.sql): alerta para el equipo. */
  fixedTime: boolean
}

export type JobWorkStatus = 'sin_iniciar' | 'en_curso' | 'finalizado'

export interface JobWork {
  /** en_curso = alguien lo inició y no lo ha finalizado; finalizado = todos los que lo iniciaron lo cerraron. */
  status: JobWorkStatus
  logs: { workerLabel: string; startedAt: string; finishedAt: string | null; startedWithOpen: boolean }[]
}

export interface AdminJobsData {
  from: string
  to: string
  jobs: AdminJob[]
  workers: Worker[]
  vehicles: VehicleView[]
}
