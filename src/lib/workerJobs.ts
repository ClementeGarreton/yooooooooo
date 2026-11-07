/**
 * Agenda de un trabajador: los trabajos de los próximos días que le tocan.
 *
 * Le toca un trabajo si (a) el admin lo asignó a esa reserva (`booking_workers`) o (b) la
 * reserva es de su camión habitual. Lo segundo es para que el chofer de un camión vea lo
 * suyo igual que con el link por camión, sin que nadie tenga que asignarlo reserva por
 * reserva; lo primero es para las cuadrillas (peonetas que van a un servicio puntual).
 *
 * Sale de `getUpcomingDriverJobs`, la misma función del link de choferes: misma ventana
 * de días, mismo reparto de camiones y, sobre todo, SIN precios.
 */

import { supabaseAdmin } from '@/lib/supabase'
import { getUpcomingDriverJobs, readDriverJobsBetween, type DriverAgenda, type DriverJob } from '@/lib/driverJobs'
import { getFleetVehicleViews } from '@/lib/vehicleAssignment'
import type { Worker } from '@/lib/workers'

export async function getWorkerAgenda(worker: Pick<Worker, 'id' | 'vehicle_id'>): Promise<DriverAgenda> {
  const [{ jobs, vehicles }, { data: assigned }] = await Promise.all([
    getUpcomingDriverJobs(null),
    supabaseAdmin.from('booking_workers').select('booking_id').eq('worker_id', worker.id),
  ])
  const assignedIds = new Set((assigned || []).map((r) => r.booking_id))
  const mine = jobs.filter(
    (j) => assignedIds.has(j.id) || (worker.vehicle_id !== null && j.vehicle_id === worker.vehicle_id)
  )
  return { jobs: mine, vehicles }
}

/** Días hacia atrás que muestra el historial. */
export const WORKER_HISTORY_DAYS = 90
/**
 * Días después de un trabajo en que todavía se le pueden agregar notas, diferencias,
 * fotos y gastos: la rendición se hace después del servicio, no solo antes.
 */
export const WORKER_ACTION_DAYS = 30

function chileDate(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(d)
}

/** Lo que le tocó a un trabajador entre dos fechas: asignado en la cuadrilla o su camión. */
async function workerJobsBetween(worker: Pick<Worker, 'id' | 'vehicle_id'>, from: string, to: string): Promise<DriverJob[]> {
  const [jobs, { data: assigned }] = await Promise.all([
    readDriverJobsBetween(from, to),
    supabaseAdmin.from('booking_workers').select('booking_id').eq('worker_id', worker.id),
  ])
  const assignedIds = new Set((assigned || []).map((r) => r.booking_id))
  return jobs.filter((j) => assignedIds.has(j.id) || (worker.vehicle_id !== null && j.vehicle_id === worker.vehicle_id))
}

/** Historial: los trabajos de los últimos días, del más nuevo al más viejo. */
/** Hasta cuántos días atrás puede buscar el trabajador con el filtro de fechas. */
export const WORKER_HISTORY_MAX_DAYS = 365

/**
 * Historial del trabajador: los últimos WORKER_HISTORY_DAYS días o, con `range` (filtro de
 * fechas de su buscador, Tomás 21-10-2026), ese rango dentro del último año y hasta ayer.
 */
export async function getWorkerHistory(
  worker: Pick<Worker, 'id' | 'vehicle_id'>,
  range?: { from?: string | null; to?: string | null }
): Promise<DriverAgenda> {
  const valid = (d: string | null | undefined) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null)
  const floor = chileDate(-WORKER_HISTORY_MAX_DAYS)
  const yesterday = chileDate(-1)
  // Solo «hasta»: desde el tope del año, no desde los últimos 90 días (si no, queda vacío).
  let from = valid(range?.from) || (valid(range?.to) ? floor : chileDate(-WORKER_HISTORY_DAYS))
  let to = valid(range?.to) || yesterday
  if (from < floor) from = floor
  if (to > yesterday) to = yesterday
  const [jobs, vehicles] = await Promise.all([
    from <= to ? workerJobsBetween(worker, from, to) : Promise.resolve([]),
    getFleetVehicleViews(),
  ])
  return { jobs, vehicles }
}

/**
 * ¿Puede el trabajador escribir (nota, diferencia, archivo) sobre este trabajo? Sí si está
 * en su agenda de los próximos días o fue suyo en los últimos WORKER_ACTION_DAYS.
 */
export async function workerCanActOn(worker: Pick<Worker, 'id' | 'vehicle_id'>, bookingId: string): Promise<DriverJob | null> {
  const agenda = await getWorkerAgenda(worker)
  const upcoming = agenda.jobs.find((j) => j.id === bookingId)
  if (upcoming) return upcoming
  const recent = await workerJobsBetween(worker, chileDate(-WORKER_ACTION_DAYS), chileDate(-1))
  return recent.find((j) => j.id === bookingId) || null
}

export interface JobTeamMember {
  id: string
  name: string
  phone: string | null
}

/**
 * Quiénes van a cada trabajo: los puestos en la cuadrilla más los que tienen ese camión
 * como habitual. Es para que el equipo sepa con quién trabaja y se coordine; solo nombre y
 * teléfono, y solo trabajadores activos.
 */
export async function getJobTeams(jobs: Pick<DriverJob, 'id' | 'vehicle_id'>[]): Promise<Map<string, JobTeamMember[]>> {
  const out = new Map<string, JobTeamMember[]>()
  if (jobs.length === 0) return out
  const [{ data: workers }, { data: crew }] = await Promise.all([
    supabaseAdmin.from('workers').select('id, name, phone, vehicle_id, active').eq('active', true).order('name'),
    supabaseAdmin.from('booking_workers').select('booking_id, worker_id').in('booking_id', jobs.map((j) => j.id)),
  ])
  const crewByBooking = new Map<string, Set<string>>()
  for (const r of crew || []) {
    if (!crewByBooking.has(r.booking_id)) crewByBooking.set(r.booking_id, new Set())
    crewByBooking.get(r.booking_id)!.add(r.worker_id)
  }
  for (const job of jobs) {
    const assigned = crewByBooking.get(job.id)
    out.set(
      job.id,
      (workers || [])
        .filter((w) => assigned?.has(w.id) || (job.vehicle_id !== null && w.vehicle_id === job.vehicle_id))
        .map((w) => ({ id: w.id, name: w.name, phone: w.phone }))
    )
  }
  return out
}
