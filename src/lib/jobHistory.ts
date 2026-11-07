/**
 * HISTORIAL DE TRABAJOS (panel Trabajos → Historial).
 *
 * Todos los trabajos ya realizados —reservas reales con fecha de hoy hacia atrás, sin las
 * canceladas ni las no atendidas—, buscables por texto (ID, cliente, teléfono, direcciones),
 * camión, trabajador y fechas. Es solo lectura: a diferencia de la vista de asignación, no
 * reparte camiones ni toca nada.
 *
 * «Trabajador» sigue la misma regla del pago y de su panel: fue a un trabajo si estaba en
 * la cuadrilla o si el camión del trabajo es su camión habitual.
 */

import { supabaseAdmin } from '@/lib/supabase'
import { getFleetVehicleViews } from '@/lib/vehicleAssignment'
import type { JobWorkStatus } from '@/lib/adminJobsTypes'
import type { JobHistoryData, JobHistoryRow } from '@/lib/jobHistoryTypes'

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const JOB_HISTORY_PAGE_SIZE = 50

const todayChile = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date())

export async function searchJobHistory(input: {
  q?: string | null
  vehicleId?: string | null
  workerId?: string | null
  from?: string | null
  to?: string | null
  page?: string | null
}): Promise<JobHistoryData> {
  const today = todayChile()
  const from = input.from && DAY_RE.test(input.from) ? input.from : null
  // Nunca más allá de hoy: lo que viene está en la vista de asignación.
  const to = input.to && DAY_RE.test(input.to) && input.to < today ? input.to : today
  const page = Math.max(1, Math.round(Number(input.page)) || 1)
  const vehicleId = input.vehicleId && /^\d+$/.test(input.vehicleId) ? Number(input.vehicleId) : null
  const workerId = input.workerId && UUID_RE.test(input.workerId) ? input.workerId : null
  // Sin los caracteres que PostgREST usa para armar el filtro `or`.
  const q = String(input.q || '').replace(/[,()%*\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)

  const [vehicles, { data: workers }] = await Promise.all([
    getFleetVehicleViews(),
    supabaseAdmin.from('workers').select('id, name, code, vehicle_id, active').order('name'),
  ])
  const workerList = (workers || []) as { id: string; name: string; code: string; vehicle_id: number | null; active: boolean }[]

  let query = supabaseAdmin
    .from('bookings')
    .select('*', { count: 'exact' })
    .lte('scheduled_date', to)
    .not('status', 'in', '(cancelled,no_show)')
    .not('quote_id', 'like', 'ADMIN-BLOQUEO-%')
    .or('is_provisional.is.null,is_provisional.eq.false')
  if (from) query = query.gte('scheduled_date', from)
  if (vehicleId !== null) query = query.eq('vehicle_id', vehicleId)

  if (workerId) {
    const worker = workerList.find((w) => w.id === workerId)
    const { data: crew } = await supabaseAdmin.from('booking_workers').select('booking_id').eq('worker_id', workerId).limit(5000)
    const ids = (crew || []).map((r) => r.booking_id)
    const parts = [ids.length > 0 ? `id.in.(${ids.join(',')})` : null, worker?.vehicle_id != null ? `vehicle_id.eq.${worker.vehicle_id}` : null].filter(Boolean)
    // Sin cuadrillas ni camión habitual, ese trabajador no tiene ningún trabajo.
    if (parts.length === 0) return { rows: [], total: 0, page: 1, pageSize: JOB_HISTORY_PAGE_SIZE, vehicles: vehicles.map((v) => ({ id: v.id, name: v.name })), workers: workerList.map(({ id, name, code }) => ({ id, name, code })) }
    query = query.or(parts.join(','))
  }

  if (q) {
    const like = `%${q}%`
    query = query.or(
      ['code', 'client_name', 'client_phone', 'origin_address', 'destination_address', 'visit_address'].map((column) => `${column}.ilike.${like}`).join(',')
    )
  }

  const start = (page - 1) * JOB_HISTORY_PAGE_SIZE
  const { data, count, error } = await query
    .order('scheduled_date', { ascending: false })
    .order('scheduled_time', { ascending: false })
    .range(start, start + JOB_HISTORY_PAGE_SIZE - 1)
  if (error) throw new Error(`No se pudo leer el historial: ${error.message}`)
  const bookings = (data || []) as Record<string, any>[]
  const ids = bookings.map((b) => b.id)

  const [{ data: crewRows }, logsResult] = await Promise.all([
    ids.length ? supabaseAdmin.from('booking_workers').select('booking_id, worker_id').in('booking_id', ids) : Promise.resolve({ data: [] as any[] }),
    ids.length
      ? supabaseAdmin.from('booking_work_logs').select('booking_id, finished_at').in('booking_id', ids)
      : Promise.resolve({ data: [] as any[], error: null }),
  ])
  const crewByBooking = new Map<string, Set<string>>()
  for (const r of (crewRows || []) as any[]) {
    if (!crewByBooking.has(r.booking_id)) crewByBooking.set(r.booking_id, new Set())
    crewByBooking.get(r.booking_id)!.add(r.worker_id)
  }
  const logsByBooking = new Map<string, { finished_at: string | null }[]>()
  for (const r of ((logsResult as any).error ? [] : (logsResult.data || [])) as any[]) {
    logsByBooking.set(r.booking_id, [...(logsByBooking.get(r.booking_id) || []), r])
  }
  const vehicleName = new Map(vehicles.map((v) => [v.id, v.name]))

  const rows: JobHistoryRow[] = bookings.map((b) => {
    const crew = crewByBooking.get(b.id)
    const logs = logsByBooking.get(b.id) || []
    const work: JobWorkStatus = logs.length === 0 ? 'sin_iniciar' : logs.some((l) => !l.finished_at) ? 'en_curso' : 'finalizado'
    return {
      id: b.id,
      code: b.code ?? null,
      quoteId: b.quote_id ?? null,
      date: b.scheduled_date,
      time: b.scheduled_time ?? null,
      clientName: b.client_name || '',
      clientPhone: b.client_phone ?? null,
      origin: b.visit_address || b.origin_address || '',
      destination: b.visit_address ? '' : b.destination_address || '',
      status: b.status || '',
      vehicleId: typeof b.vehicle_id === 'number' ? b.vehicle_id : null,
      vehicleName: typeof b.vehicle_id === 'number' ? vehicleName.get(b.vehicle_id) || `Camión ${b.vehicle_id}` : null,
      workers: workerList
        .filter((w) => crew?.has(w.id) || (w.active && typeof b.vehicle_id === 'number' && w.vehicle_id === b.vehicle_id))
        .map((w) => w.name),
      work,
    }
  })

  return {
    rows,
    total: count || 0,
    page,
    pageSize: JOB_HISTORY_PAGE_SIZE,
    vehicles: vehicles.map((v) => ({ id: v.id, name: v.name })),
    workers: workerList.map(({ id, name, code }) => ({ id, name, code })),
  }
}
