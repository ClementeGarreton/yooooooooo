/**
 * Cupos de un día, por horario. Es la cuenta que muestra el calendario del cotizador
 * (/api/bookings/available) y la que valida la reprogramación del Panel del Cliente:
 * vivía dentro de esa ruta y se sacó acá para que las dos no se separen el día que
 * cambie la regla.
 *
 * Un horario está libre si las reservas confirmadas o pendientes en esa fecha y hora son
 * menos que los camiones activos, y no hay un bloqueo de agenda que lo cubra.
 */

import { supabaseAdmin } from '@/lib/supabase'
import { getActiveCapacity } from '@/lib/fleetCapacity'

export interface SlotAvailability {
  time: string
  label: string
  recommended: boolean
  availableSlots: number
  capacity: number
  booked: number
  isBlocked: boolean
  isAvailable: boolean
  occupancy: string
}

/** Falta o falla la configuración de flota: sin ella no se puede contar cupo. */
export class FleetConfigError extends Error {
  constructor(public readonly kind: 'error' | 'missing', cause?: unknown) {
    super(kind === 'missing' ? 'Configuración de flota no encontrada' : 'Error obteniendo configuración de flota')
    this.name = 'FleetConfigError'
    if (cause) console.error('Error fetching fleet config:', cause)
  }
}

// Si no existe configuración, usar horarios por defecto.
const DEFAULT_SLOTS = [
  { time: '08:00', label: '08:00 hrs', recommended: true },
  { time: '09:00', label: '09:00 hrs', recommended: true },
  { time: '10:00', label: '10:00 hrs', recommended: true },
  { time: '11:00', label: '11:00 hrs', recommended: false },
  { time: '14:00', label: '14:00 hrs', recommended: true },
  { time: '15:00', label: '15:00 hrs', recommended: false },
]

/**
 * Todos los horarios configurados de `date`, con su ocupación.
 *
 * `excludeBookingId`: una reserva que se está moviendo no cuenta contra su propio cupo
 * (mismo criterio que la reprogramación del panel admin).
 */
export async function getSlotAvailability(
  date: string,
  opts: { excludeBookingId?: string } = {}
): Promise<SlotAvailability[]> {
  // 1. Capacidad de vehículos (activos, no total). select('*') para ser resiliente si la
  // columna `vehicles` aún no existe (migración add_fleet_vehicles.sql no aplicada).
  const { data: configData, error: configError } = await supabaseAdmin
    .from('fleet_config')
    .select('*')
    .single()

  if (configError) throw new FleetConfigError('error', configError)
  if (!configData) throw new FleetConfigError('missing')

  const capacity = getActiveCapacity(configData)

  // 2. Horarios configurados en schedule_config.
  const { data: scheduleConfig } = await supabaseAdmin
    .from('schedule_config')
    .select('time_slots')
    .single()

  let timeSlotsWithMetadata = DEFAULT_SLOTS
  if (scheduleConfig && scheduleConfig.time_slots && Array.isArray(scheduleConfig.time_slots)) {
    timeSlotsWithMetadata = scheduleConfig.time_slots
  }

  // 3. Para cada horario, contar reservas y bloqueos.
  return Promise.all(
    timeSlotsWithMetadata.map(async (slot) => {
      const time = slot.time
      const label = slot.label
      const recommended = slot.recommended || false

      // Contar mudanzas confirmadas y pendientes.
      let bookingsQuery = supabaseAdmin
        .from('bookings')
        .select('id', { count: 'exact', head: true })
        .eq('scheduled_date', date)
        .eq('scheduled_time', time)
        .in('status', ['confirmed', 'pending'])
      if (opts.excludeBookingId) bookingsQuery = bookingsQuery.neq('id', opts.excludeBookingId)
      const { count: bookingCount } = await bookingsQuery

      // Verificar si está bloqueado.
      const { data: blockedData } = await supabaseAdmin
        .from('blocked_slots')
        .select('id')
        .eq('date', date)
        .lte('start_time', time)
        .gt('end_time', time)

      const isBlocked = Boolean(blockedData && blockedData.length > 0)
      const activeBookings = bookingCount || 0
      const availableSlots = capacity - activeBookings
      const isAvailable = availableSlots > 0 && !isBlocked

      return {
        time,
        label,
        recommended,
        availableSlots: Math.max(0, availableSlots),
        capacity,
        booked: activeBookings,
        isBlocked,
        isAvailable,
        occupancy: `${activeBookings}/${capacity}`,
      }
    })
  )
}
