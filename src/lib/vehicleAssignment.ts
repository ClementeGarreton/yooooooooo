import { supabaseAdmin } from '@/lib/supabase'
import { notifyAutoAssigned } from '@/lib/workerNotifications'
import { getFleetVehicles, type FleetVehicle } from '@/lib/fleetCapacity'
import { resolveVehicleColor, type VehicleColor } from '@/lib/vehicleColors'

// Asignación de reservas a camiones.
//
// Regla de oro: lo asignado a mano manda. El reparto automático solo toca reservas
// FUTURAS que todavía no tienen camión, y una vez que escribe el vehicle_id no lo
// vuelve a mover; si el admin reasigna, esa decisión queda firme.
//
// Desde sep-2026 el reparto CONSOLIDA en vez de equilibrar (pedido de Tomás): un trabajo
// nuevo va al primer camión que esté libre a esa hora, y recién cuando ninguno de los que
// ya están trabajando ese día puede tomarlo se abre el siguiente. «Libre» mira la
// DURACIÓN, no solo la hora de inicio: un camión con una mudanza de 09:00 a 13:00 no
// puede tomar la de las 10:00. La disponibilidad pública (/api/bookings/available) no
// cambia: sigue contando cupos por horario sobre toda la flota.
//
// Todas las lecturas de vehicle_id toleran que la migración add_booking_vehicle_assignment.sql
// no esté aplicada: en ese caso devuelven vacío y la app funciona igual, sin colores.

/** "Hoy" en hora de Chile: el server corre en UTC y de noche cae al día siguiente. */
export function chileTodayString(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date())
}

export interface VehicleView {
  id: number
  name: string
  driver: string
  status: 'active' | 'maintenance'
  color: VehicleColor
  /** «Mudanzas simultáneas» del panel de Flota. Mínimo 1. */
  capacity: number
}

export interface AssignableBooking {
  id: string
  scheduled_date: string
  scheduled_time?: string | null
  /** Sin dato se asumen `DEFAULT_JOB_HOURS`, igual que al crear una reserva. */
  duration_hours?: number | null
  is_provisional?: boolean | null
  status?: string | null
}

/** Duración que se asume cuando la reserva no la trae: la misma que ponen las rutas al crear. */
export const DEFAULT_JOB_HOURS = 4

const MINUTES_IN_DAY = 24 * 60

/**
 * Ventana del trabajo dentro de su día, en minutos. Sin hora se toma el día entero: no se
 * sabe cuándo ocurre, así que no se puede afirmar que otro trabajo quepa al lado. Una
 * duración que se pasa de medianoche se corta ahí (el reparto es por día).
 */
export function jobWindow(b: Pick<AssignableBooking, 'scheduled_time' | 'duration_hours'>): {
  start: number
  end: number
} {
  const match = /^(\d{1,2}):(\d{2})/.exec(String(b.scheduled_time || ''))
  if (!match) return { start: 0, end: MINUTES_IN_DAY }
  const start = Number(match[1]) * 60 + Number(match[2])
  const hours = Number(b.duration_hours)
  const duration = Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_JOB_HOURS
  return { start, end: Math.min(start + Math.round(duration * 60), MINUTES_IN_DAY) }
}

function windowsOverlap(a: { start: number; end: number }, b: { start: number; end: number }) {
  return a.start < b.end && b.start < a.end
}

const hhmm = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`

/** Cómo está cada camión para un trabajo concreto (fecha + hora + duración). */
export interface VehicleSlotStatus {
  id: number
  name: string
  color: VehicleColor
  status: 'active' | 'maintenance'
  capacity: number
  /** Trabajos de ese camión que se pisan con el nuevo. */
  overlapping: Array<{ id: string; from: string; to: string }>
  /** Trabajos que ese camión ya tiene ese día, se pisen o no. */
  jobsThatDay: number
  /** Activo y con lugar a esa hora. */
  available: boolean
}

/**
 * Estado de cada camión para un trabajo. `dayJobs` son los trabajos reales del mismo día
 * (sin el propio) y `assignments` dice en qué camión está cada uno. Un trabajo sin camión
 * no ocupa a ninguno: todavía no se sabe dónde va.
 */
export function vehicleSlotStatuses(
  target: Pick<AssignableBooking, 'scheduled_time' | 'duration_hours'>,
  vehicles: VehicleView[],
  dayJobs: AssignableBooking[],
  assignments: Map<string, number>
): VehicleSlotStatus[] {
  const window = jobWindow(target)
  return vehicles.map((v) => {
    const own = dayJobs.filter((j) => isRealJob(j) && assignments.get(j.id) === v.id)
    const overlapping = own
      .map((j) => ({ j, w: jobWindow(j) }))
      .filter(({ w }) => windowsOverlap(window, w))
      .map(({ j, w }) => ({ id: j.id, from: hhmm(w.start), to: hhmm(w.end) }))
    return {
      id: v.id,
      name: v.name,
      color: v.color,
      status: v.status,
      capacity: v.capacity,
      overlapping,
      jobsThatDay: own.length,
      available: v.status === 'active' && overlapping.length < Math.max(1, v.capacity || 1),
    }
  })
}

/**
 * El camión que le corresponde a un trabajo nuevo. `statuses` va en el orden de la flota.
 *
 * Primero los camiones que YA trabajan ese día y tienen lugar a esa hora, en orden de
 * flota; después los que todavía no salen. Así se llena uno antes de abrir el siguiente:
 * con la flota vacía, todo va al Camión 1 hasta que un trabajo se le pise.
 *
 * Si ninguno tiene lugar (el horario se sobrevendió, o la web vendió un cupo que se pisa
 * con una mudanza larga), igual se elige uno —el que menos choques tenga—, con
 * `fits: false`. Un trabajo sin camión desaparece del link de los choferes, y eso es peor
 * que un camión con un choque que el admin ve y corrige.
 */
export function pickVehicle(
  statuses: VehicleSlotStatus[]
): { vehicleId: number; fits: boolean } | null {
  const active = statuses
    .map((s, fleetIndex) => ({ s, fleetIndex }))
    .filter(({ s }) => s.status === 'active')
  if (active.length === 0) return null

  const fitting = active
    .filter(({ s }) => s.available)
    .sort(
      (a, b) =>
        (a.s.jobsThatDay > 0 ? 0 : 1) - (b.s.jobsThatDay > 0 ? 0 : 1) ||
        a.fleetIndex - b.fleetIndex
    )
  if (fitting.length > 0) return { vehicleId: fitting[0].s.id, fits: true }

  const leastBad = [...active].sort(
    (a, b) =>
      a.s.overlapping.length - b.s.overlapping.length ||
      a.s.jobsThatDay - b.s.jobsThatDay ||
      a.fleetIndex - b.fleetIndex
  )
  return { vehicleId: leastBad[0].s.id, fits: false }
}

/** No ocupan camión: pre-reservas sin pagar y trabajos que no se van a hacer. */
function isRealJob(b: AssignableBooking): boolean {
  return !b.is_provisional && !['cancelled', 'no_show'].includes(b.status || '')
}

/** La flota con su color ya resuelto, en el orden en que está configurada. */
export async function getFleetVehicleViews(): Promise<VehicleView[]> {
  const { data } = await supabaseAdmin.from('fleet_config').select('*').single()
  return getFleetVehicles(data).map((v: FleetVehicle, i) => ({
    id: v.id,
    name: v.name || `Camión ${i + 1}`,
    driver: v.driver || '',
    status: v.status === 'maintenance' ? 'maintenance' : 'active',
    color: resolveVehicleColor(v, i),
    capacity: Math.max(1, Number(v.capacity) || 1),
  }))
}

/** Asignaciones de un rango de fechas: id de reserva → id de camión. */
export async function getVehicleAssignmentsInRange(
  from: string,
  to: string
): Promise<Map<string, number>> {
  const { data, error } = await supabaseAdmin
    .from('bookings')
    .select('id, vehicle_id')
    .gte('scheduled_date', from)
    .lte('scheduled_date', to)

  if (error) {
    console.error('[vehicleAssignment] No se pudo leer vehicle_id (¿falta la migración?):', error.message)
    return new Map()
  }
  return toAssignmentMap(data)
}

/** Todas las asignaciones existentes (para la tabla del admin, que muestra el histórico). */
export async function getAllVehicleAssignments(): Promise<Map<string, number>> {
  const { data, error } = await supabaseAdmin
    .from('bookings')
    .select('id, vehicle_id')
    .not('vehicle_id', 'is', null)

  if (error) {
    console.error('[vehicleAssignment] No se pudo leer vehicle_id (¿falta la migración?):', error.message)
    return new Map()
  }
  return toAssignmentMap(data)
}

function toAssignmentMap(rows: unknown): Map<string, number> {
  const map = new Map<string, number>()
  for (const row of (rows as Array<{ id?: string; vehicle_id?: number | null }>) || []) {
    if (row?.id && typeof row.vehicle_id === 'number') map.set(row.id, row.vehicle_id)
  }
  return map
}

/**
 * Asigna camión a las reservas futuras que aún no tienen uno y persiste el resultado.
 * Devuelve el mapa completo (lo que ya había + lo nuevo).
 *
 * Cada trabajo, en orden de hora, va al camión que devuelve `pickVehicle`: consolida en
 * el primero que tenga lugar a esa hora antes de abrir otro. Lo que ya tenía camión no se
 * mueve, aunque con esta regla hubiera quedado en otro: puede haberlo puesto el admin a
 * mano, y no hay forma de distinguirlo.
 */
export async function ensureVehicleAssignments(
  bookings: AssignableBooking[],
  vehicles: VehicleView[],
  existing: Map<string, number>
): Promise<Map<string, number>> {
  const active = vehicles.filter((v) => v.status === 'active')
  if (active.length === 0) return existing

  const today = chileTodayString()
  const activeIds = new Set(active.map((v) => v.id))

  // Solo trabajos reales de hoy en adelante. El pasado se deja como está: reasignar
  // retroactivamente no sirve a nadie y sería una escritura masiva la primera vez.
  const relevant = bookings.filter((b) => b.scheduled_date >= today && isRealJob(b))
  const pending = relevant.filter((b) => {
    const assigned = existing.get(b.id)
    // Se reasigna también lo que apunta a un camión que ya no existe o está en
    // mantenimiento: si no, esos trabajos quedarían huérfanos en la vista.
    return assigned === undefined || !activeIds.has(assigned)
  })
  if (pending.length === 0) return existing

  // Lo que ocupa camión mientras se reparte: lo ya asignado a camiones activos, más lo
  // que se va asignando en esta misma pasada (así dos trabajos nuevos del mismo día no
  // caen los dos en el mismo hueco).
  const working = new Map<string, number>()
  existing.forEach((vehicleId, bookingId) => {
    if (activeIds.has(vehicleId)) working.set(bookingId, vehicleId)
  })

  // Orden estable: mismo input, mismo reparto, aunque dos pestañas lo calculen a la vez.
  const ordered = [...pending].sort((a, b) => {
    if (a.scheduled_date !== b.scheduled_date) return a.scheduled_date < b.scheduled_date ? -1 : 1
    const at = a.scheduled_time || ''
    const bt = b.scheduled_time || ''
    if (at !== bt) return at < bt ? -1 : 1
    return a.id < b.id ? -1 : 1
  })

  const writes: Array<{ id: string; vehicle_id: number }> = []

  for (const booking of ordered) {
    const dayJobs = relevant.filter(
      (b) => b.scheduled_date === booking.scheduled_date && b.id !== booking.id
    )
    const pick = pickVehicle(vehicleSlotStatuses(booking, active, dayJobs, working))
    if (!pick) continue
    working.set(booking.id, pick.vehicleId)
    writes.push({ id: booking.id, vehicle_id: pick.vehicleId })
  }

  const saved = await Promise.all(
    writes.map(async (w) => {
      const { error } = await supabaseAdmin
        .from('bookings')
        .update({ vehicle_id: w.vehicle_id })
        .eq('id', w.id)
      if (error) {
        console.error('[vehicleAssignment] No se pudo asignar camión a', w.id, error.message)
        return null
      }
      return w
    })
  )

  // Solo se refleja lo que quedó realmente escrito: si la migración no está aplicada,
  // esto devuelve el mapa original en vez de un color que la BD no conoce.
  const result = new Map(existing)
  for (const w of saved) {
    if (w) result.set(w.id, w.vehicle_id)
  }
  // A quien tiene ese camión como habitual le llega el aviso del trabajo nuevo.
  await notifyAutoAssigned(saved.filter((w): w is { id: string; vehicle_id: number } => w !== null))
  return result
}
