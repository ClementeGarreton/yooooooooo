import { supabaseAdmin } from '@/lib/supabase'
import { normalizeStops, type QuoteStop } from '@/lib/stops'
import {
  ensureVehicleAssignments,
  getFleetVehicleViews,
  getVehicleAssignmentsInRange,
  type VehicleView,
  type AssignableBooking,
} from '@/lib/vehicleAssignment'

// Datos para el panel público de choferes: SIN precios. Nunca seleccionamos
// total_price / original_price aquí para que no puedan filtrarse al link público.

// "Hoy" en hora de Chile: el server (Vercel) corre en UTC, así que un new Date() naive
// puede caer en el día siguiente durante la noche chilena (mismo criterio que
// /api/admin/today-bookings).
function chileTodayString(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date())
}

/** Suma días a una fecha 'YYYY-MM-DD' sin pasar por UTC. */
function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  date.setDate(date.getDate() + days)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`
}

/**
 * Ventana visible para los choferes: hoy + 3 días = 4 días en total. Se acota a
 * propósito para que no vean toda la agenda futura en un link compartido.
 */
export const DRIVER_WINDOW_DAYS = 4

export interface DriverJobItem {
  name: string
  quantity: number
}

export interface DriverJob {
  id: string
  /** Identificador con el que busca la pestaña Reservas del panel. */
  quote_id: string | null
  scheduled_date: string
  scheduled_time: string | null
  client_name: string
  client_phone: string
  booking_type: string
  visit_address: string | null
  origin_address: string
  origin_floor: number | null
  origin_has_elevator: boolean | null
  origin_parking_distance: number | null
  destination_address: string
  destination_floor: number | null
  destination_has_elevator: boolean | null
  destination_parking_distance: number | null
  notes: string | null
  /** Paradas intermedias, en orden. El chofer las necesita para armar el recorrido. */
  stops: QuoteStop[]
  items: DriverJobItem[]
  /** Camión asignado. null = todavía sin asignar (grupo aparte en la vista). */
  vehicle_id: number | null
  /** Retiro o entrega con hora fija (add_pendientes_oct.sql): se muestra como alerta. */
  fixed_time?: boolean
}

/**
 * Marca la hora fija en los trabajos. Se lee aparte para que la agenda no se caiga si
 * todavía no corre add_pendientes_oct.sql (entonces ninguno la tiene).
 */
async function withFixedTime(jobs: DriverJob[]): Promise<DriverJob[]> {
  if (jobs.length === 0) return jobs
  const { data, error } = await supabaseAdmin.from('bookings').select('id, fixed_time').in('id', jobs.map((j) => j.id))
  if (error) return jobs
  const fixed = new Set(((data || []) as { id: string; fixed_time: boolean }[]).filter((r) => r.fixed_time).map((r) => r.id))
  return jobs.map((j) => ({ ...j, fixed_time: fixed.has(j.id) }))
}

export interface DriverAgenda {
  jobs: DriverJob[]
  /** Flota con su color, para pintar las secciones y la leyenda. */
  vehicles: VehicleView[]
}

/**
 * Agenda visible para un link de choferes.
 *
 * `vehicleId` acota la vista a UN camión: es lo que hace que el link de cada camión
 * muestre solo lo suyo. Con `null` (link general heredado) se devuelve todo.
 *
 * El filtro se aplica DESPUÉS del reparto automático a propósito: así entrar por el
 * link de un camión sigue asignando camión a todas las reservas nuevas de la ventana,
 * y no solo a las que ya eran de ese camión.
 */
export async function getUpcomingDriverJobs(
  vehicleId: number | null = null
): Promise<DriverAgenda> {
  const today = chileTodayString()
  // Tope de la ventana: hoy + 3 = 4 días visibles.
  const windowEnd = addDays(today, DRIVER_WINDOW_DAYS - 1)

  // Mismo criterio que el dashboard admin ("Reservas de Hoy/Mañana"): no restringir
  // por status confirmed/pending, porque una reserva de hoy puede ya estar marcada
  // 'completed' en el sistema (pago aprobado) y sigue siendo un trabajo real que el
  // chofer necesita ver. Solo excluimos canceladas / no atendidas.
  const BASE_COLUMNS =
    'id, quote_id, scheduled_date, scheduled_time, duration_hours, client_name, client_phone, booking_type, visit_address, origin_address, origin_floor, origin_has_elevator, origin_parking_distance, destination_address, destination_floor, destination_has_elevator, destination_parking_distance, notes, is_provisional, status'

  const consultar = (conParadas: boolean) =>
    supabaseAdmin
      .from('bookings')
      .select(conParadas ? `${BASE_COLUMNS}, stops` : BASE_COLUMNS)
      .gte('scheduled_date', today)
      .lte('scheduled_date', windowEnd)
      .not('status', 'in', '(cancelled,no_show)')
      .order('scheduled_date', { ascending: true })
      .order('scheduled_time', { ascending: true })

  // 42703 = columna inexistente: falta add_quote_stops.sql. La agenda del chofer no se
  // puede quedar en blanco por eso, así que se reintenta sin las paradas.
  let { data: bookings, error } = await consultar(true)
  if (error?.code === '42703') {
    console.warn('[driverJobs] Sin paradas todavía (¿falta add_quote_stops.sql?)')
    ;({ data: bookings, error } = await consultar(false))
  }

  // Solo trabajos reales (las pre-reservas sin pagar no ocupan cupo ni son trabajo).
  // El `select` se arma como string (con o sin `stops`), así que Supabase ya no infiere
  // el tipo de las filas: se declara acá.
  type FilaReserva = AssignableBooking & Record<string, any>
  const rows = ((bookings || []) as unknown as FilaReserva[]).filter((b) => !b.is_provisional)

  // Reparto de camiones: los que ya tienen uno (automático o puesto a mano por el
  // admin) lo conservan; los nuevos se reparten aquí y quedan guardados.
  const vehicles = await getFleetVehicleViews()
  const assignments = await ensureVehicleAssignments(
    rows,
    vehicles,
    await getVehicleAssignmentsInRange(today, windowEnd)
  )

  // Items a mover viven en quote_prospects (por quote_id).
  const quoteIds = Array.from(
    new Set(rows.map((r) => r.quote_id).filter((q): q is string => Boolean(q)))
  )
  const itemsByQuote = new Map<string, DriverJobItem[]>()

  if (quoteIds.length > 0) {
    const { data: prospects } = await supabaseAdmin
      .from('quote_prospects')
      .select('quote_id, items_summary')
      .in('quote_id', quoteIds)

    for (const p of prospects || []) {
      const raw = (p as { items_summary?: unknown }).items_summary
      const items: DriverJobItem[] = Array.isArray(raw)
        ? raw
            .filter((it): it is { name: string; quantity?: number } =>
              Boolean(it && typeof it === 'object' && 'name' in it && (it as { name?: unknown }).name)
            )
            .map((it) => ({ name: String(it.name), quantity: Number(it.quantity) || 1 }))
        : []
      if (p.quote_id) itemsByQuote.set(p.quote_id, items)
    }
  }

  const mapped: DriverJob[] = rows.map((b) => ({
    id: b.id,
    quote_id: b.quote_id ?? null,
    scheduled_date: b.scheduled_date,
    scheduled_time: b.scheduled_time ?? null,
    client_name: b.client_name || '',
    client_phone: b.client_phone || '',
    booking_type: b.booking_type || 'online',
    visit_address: b.visit_address ?? null,
    origin_address: b.origin_address || '',
    origin_floor: b.origin_floor ?? null,
    origin_has_elevator: b.origin_has_elevator ?? null,
    origin_parking_distance: b.origin_parking_distance ?? null,
    destination_address: b.destination_address || '',
    destination_floor: b.destination_floor ?? null,
    destination_has_elevator: b.destination_has_elevator ?? null,
    destination_parking_distance: b.destination_parking_distance ?? null,
    notes: b.notes ?? null,
    stops: normalizeStops(b.stops),
    items: itemsByQuote.get(b.quote_id) || [],
    vehicle_id: assignments.get(b.id) ?? null,
  }))
  const jobs = await withFixedTime(mapped)

  if (vehicleId === null) return { jobs, vehicles }

  // Vista de un solo camión: sus trabajos y su color en la leyenda. Los trabajos sin
  // camión NO aparecen acá; quedan visibles en el panel admin, que es donde se corrigen.
  return {
    jobs: jobs.filter((j) => j.vehicle_id === vehicleId),
    vehicles: vehicles.filter((v) => v.id === vehicleId),
  }
}

/**
 * Trabajos YA AGENDADOS entre dos fechas, para el historial del trabajador. A diferencia
 * de `getUpcomingDriverJobs`, solo lee: no reparte camiones (usa el que quedó guardado en
 * la reserva) y no tiene ventana fija. Igual que allá, el resultado no lleva precios.
 */
export async function readDriverJobsBetween(from: string, to: string): Promise<DriverJob[]> {
  // `*` porque `stops` y `vehicle_id` son de migraciones posteriores; lo que sale de acá
  // es el DriverJob de abajo, que no tiene ningún campo de precio.
  const { data: bookings, error } = await supabaseAdmin
    .from('bookings')
    .select('*')
    .gte('scheduled_date', from)
    .lte('scheduled_date', to)
    .not('status', 'in', '(cancelled,no_show)')
    .order('scheduled_date', { ascending: false })
    .order('scheduled_time', { ascending: false })
    .limit(500)
  if (error) {
    console.error('[driverJobs] Error leyendo el historial:', error)
    return []
  }
  const rows = ((bookings || []) as Record<string, any>[]).filter(
    (b) => !b.is_provisional && !String(b.quote_id || '').startsWith('ADMIN-BLOQUEO-')
  )

  const quoteIds = Array.from(new Set(rows.map((r) => r.quote_id).filter((q): q is string => Boolean(q))))
  const itemsByQuote = new Map<string, DriverJobItem[]>()
  if (quoteIds.length > 0) {
    const { data: prospects } = await supabaseAdmin.from('quote_prospects').select('quote_id, items_summary').in('quote_id', quoteIds)
    for (const p of prospects || []) {
      const raw = (p as { items_summary?: unknown }).items_summary
      if (p.quote_id && Array.isArray(raw)) {
        itemsByQuote.set(
          p.quote_id,
          raw
            .filter((it): it is { name: string; quantity?: number } => Boolean(it && typeof it === 'object' && (it as any).name))
            .map((it) => ({ name: String(it.name), quantity: Number(it.quantity) || 1 }))
        )
      }
    }
  }

  const mapped: DriverJob[] = rows.map((b) => ({
    id: b.id,
    quote_id: b.quote_id ?? null,
    scheduled_date: b.scheduled_date,
    scheduled_time: b.scheduled_time ?? null,
    client_name: b.client_name || '',
    client_phone: b.client_phone || '',
    booking_type: b.booking_type || 'online',
    visit_address: b.visit_address ?? null,
    origin_address: b.origin_address || '',
    origin_floor: b.origin_floor ?? null,
    origin_has_elevator: b.origin_has_elevator ?? null,
    origin_parking_distance: b.origin_parking_distance ?? null,
    destination_address: b.destination_address || '',
    destination_floor: b.destination_floor ?? null,
    destination_has_elevator: b.destination_has_elevator ?? null,
    destination_parking_distance: b.destination_parking_distance ?? null,
    notes: b.notes ?? null,
    stops: normalizeStops(b.stops),
    items: itemsByQuote.get(b.quote_id) || [],
    vehicle_id: typeof b.vehicle_id === 'number' ? b.vehicle_id : null,
    fixed_time: b.fixed_time === true,
  }))
  return mapped
}
