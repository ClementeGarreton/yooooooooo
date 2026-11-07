import { supabaseAdmin } from '@/lib/supabase'
import {
  ensureVehicleAssignments,
  getFleetVehicleViews,
  getVehicleAssignmentsInRange,
  pickVehicle,
  vehicleSlotStatuses,
  type AssignableBooking,
  type VehicleSlotStatus,
} from '@/lib/vehicleAssignment'

export interface VehicleAvailability {
  vehicles: VehicleSlotStatus[]
  /** El que elegiría «Automático». `null` si no hay camiones activos. */
  recommendedVehicleId: number | null
  /** false = ningún camión tiene lugar a esa hora; «Automático» igual asigna uno. */
  recommendedFits: boolean
}

/**
 * Cómo está la flota para un trabajo en una fecha/hora/duración. Lo usan el selector de
 * camión de Nueva Reserva y la validación del POST, así que el panel y el servidor no
 * pueden opinar distinto sobre qué camión está libre.
 *
 * Antes de mirar, reparte los trabajos del día que todavía no tienen camión (lo mismo que
 * hace cualquier lectura de reservas): si no, un trabajo sin asignar no ocuparía a nadie y
 * el selector ofrecería un camión que en realidad ya está tomado.
 */
export async function getVehicleAvailability(target: {
  scheduled_date: string
  scheduled_time: string
  duration_hours?: number | null
  /** Al editar una reserva, ella misma no cuenta como choque. */
  excludeBookingId?: string | null
}): Promise<VehicleAvailability> {
  const vehicles = await getFleetVehicleViews()

  const { data, error } = await supabaseAdmin
    .from('bookings')
    .select('id, scheduled_date, scheduled_time, duration_hours, is_provisional, status')
    .eq('scheduled_date', target.scheduled_date)
    .not('status', 'in', '(cancelled,no_show)')

  if (error) throw new Error(`No se pudieron leer las reservas del día: ${error.message}`)

  const dayJobs = ((data || []) as AssignableBooking[]).filter(
    (b) => b.id !== target.excludeBookingId
  )
  const assignments = await ensureVehicleAssignments(
    dayJobs,
    vehicles,
    await getVehicleAssignmentsInRange(target.scheduled_date, target.scheduled_date)
  )

  const statuses = vehicleSlotStatuses(target, vehicles, dayJobs, assignments)
  const pick = pickVehicle(statuses)
  return {
    vehicles: statuses,
    recommendedVehicleId: pick?.vehicleId ?? null,
    recommendedFits: pick?.fits ?? false,
  }
}
