/**
 * Panel «Trabajos» del admin: los trabajos de un rango de fechas con su camión y su
 * cuadrilla, y las dos operaciones de asignación (camión y cuadrilla). Las usa también la
 * cuadrilla del detalle de la reserva, para que haya un solo camino que registre el cambio
 * en Actividad y avise a los trabajadores.
 */

import type { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { fetchAllRows } from '@/lib/server/fetchAllRows'
import { getActorFromRequest, logAdminAction } from '@/lib/activityLog'
import { UUID_RE, WORKER_FIELDS, getAssignedWorkerIds, onlyFieldWorkers, type Worker } from '@/lib/workers'
import { ensureVehicleAssignments, getFleetVehicleViews, type AssignableBooking } from '@/lib/vehicleAssignment'
import { notifyCrewChange, notifyVehicleChange } from '@/lib/workerNotifications'
import type { AdminJob, AdminJobsData, JobWork } from '@/lib/adminJobsTypes'

export class JobError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message)
    this.name = 'JobError'
  }
}

export async function getAdminJobs(from: string, to: string): Promise<AdminJobsData> {
  const [{ data: bookings, error }, vehicles, { data: workers }] = await Promise.all([
    // `fetchAllRows`: el panel pedía 1000 y PostgREST cortaba justo ahí (`max-rows`);
    // un rango largo mostraba trabajos de menos. Orden estable con desempate por `id`.
    fetchAllRows<any>((rfrom, rto) =>
      supabaseAdmin
        .from('bookings')
        .select('*')
        .gte('scheduled_date', from)
        .lte('scheduled_date', to)
        .not('status', 'in', '(cancelled,no_show)')
        .order('scheduled_date', { ascending: true })
        .order('scheduled_time', { ascending: true })
        .order('id', { ascending: true })
        .range(rfrom, rto)
    ),
    getFleetVehicleViews(),
    supabaseAdmin.from('workers').select(WORKER_FIELDS).order('name'),
  ])
  if (error) throw new JobError('No se pudieron cargar los trabajos', 500)

  const rows = ((bookings || []) as Record<string, any>[]).filter(
    (b) => !b.is_provisional && !String(b.quote_id || '').startsWith('ADMIN-BLOQUEO-')
  )

  // Mismo reparto automático que el link de choferes: lo que todavía no tiene camión lo
  // recibe acá, para que el panel muestre lo mismo que van a ver ellos.
  const existing = new Map<string, number>()
  for (const b of rows) if (typeof b.vehicle_id === 'number') existing.set(b.id, b.vehicle_id)
  const assignments = await ensureVehicleAssignments(rows as unknown as AssignableBooking[], vehicles, existing)

  const ids = rows.map((b) => b.id)
  const { data: crewRows } = ids.length
    ? await supabaseAdmin.from('booking_workers').select('booking_id, worker_id').in('booking_id', ids)
    : { data: [] as { booking_id: string; worker_id: string }[] }
  const crewByBooking = new Map<string, string[]>()
  for (const r of crewRows || []) crewByBooking.set(r.booking_id, [...(crewByBooking.get(r.booking_id) || []), r.worker_id])
  const usedWorkers = new Set((crewRows || []).map((r) => r.worker_id))

  // Inicio y fin marcados por los trabajadores. Sin add_operacion_terreno.sql queda vacío.
  const { data: logRows, error: logError } = ids.length
    ? await supabaseAdmin
        .from('booking_work_logs')
        .select('booking_id, worker_label, started_at, finished_at, started_with_open')
        .in('booking_id', ids)
        .order('started_at', { ascending: true })
    : { data: [] as any[], error: null }
  const logsByBooking = new Map<string, JobWork['logs']>()
  for (const r of (logError ? [] : logRows || []) as any[]) {
    logsByBooking.set(r.booking_id, [
      ...(logsByBooking.get(r.booking_id) || []),
      { workerLabel: r.worker_label, startedAt: r.started_at, finishedAt: r.finished_at, startedWithOpen: Boolean(r.started_with_open) },
    ])
  }
  const workOf = (bookingId: string): JobWork => {
    const logs = logsByBooking.get(bookingId) || []
    return { status: logs.length === 0 ? 'sin_iniciar' : logs.some((l) => !l.finishedAt) ? 'en_curso' : 'finalizado', logs }
  }

  // m³ y personas: lo puesto a mano en la reserva manda; si no, lo de su cotización.
  const quoteIds = Array.from(new Set(rows.map((b) => b.quote_id).filter(Boolean)))
  const { data: quotes } = quoteIds.length
    ? await supabaseAdmin.from('quote_prospects').select('quote_id, total_volume, additional_services, created_at').in('quote_id', quoteIds).order('created_at', { ascending: true })
    : { data: [] as any[] }
  const quoteById = new Map(((quotes || []) as any[]).map((q) => [q.quote_id, q]))
  const positive = (v: unknown) => (Number(v) > 0 ? Number(v) : null)

  const jobs: AdminJob[] = rows.map((b) => ({
    id: b.id,
    code: b.code ?? null,
    quoteId: b.quote_id ?? null,
    date: b.scheduled_date,
    time: b.scheduled_time ?? null,
    durationHours: typeof b.duration_hours === 'number' ? b.duration_hours : null,
    clientName: b.client_name || '',
    bookingType: b.booking_type || 'online',
    origin: b.visit_address || b.origin_address || '',
    destination: b.visit_address ? '' : b.destination_address || '',
    status: b.status || '',
    vehicleId: assignments.get(b.id) ?? null,
    volumeM3: positive(b.volume_m3) ?? positive(quoteById.get(b.quote_id)?.total_volume),
    people: positive(b.people_needed) ?? positive(quoteById.get(b.quote_id)?.additional_services?.totalCrew),
    crew: crewByBooking.get(b.id) || [],
    work: workOf(b.id),
    fixedTime: b.fixed_time === true,
  }))

  return {
    from,
    to,
    jobs,
    // Los desactivados solo si quedaron en alguna cuadrilla, para poder sacarlos.
    // Solo choferes y peonetas: administrativos, contador y externos no se asignan a trabajos.
    workers: await onlyFieldWorkers(
      ((workers || []) as Worker[]).filter((w) => w.active || usedWorkers.has(w.id)),
      Array.from(usedWorkers)
    ),
    vehicles,
  }
}

/** Deja la cuadrilla de la reserva exactamente en `workerIds`. Devuelve la cuadrilla final. */
export async function setBookingCrew(request: NextRequest, bookingId: string, workerIds: unknown): Promise<string[]> {
  if (!UUID_RE.test(bookingId)) throw new JobError('Reserva no encontrada', 404)
  const wanted: string[] = Array.isArray(workerIds)
    ? Array.from(new Set<string>(workerIds.filter((id: unknown): id is string => typeof id === 'string' && UUID_RE.test(id))))
    : []

  const [{ data: booking }, { data: workers }, current] = await Promise.all([
    supabaseAdmin.from('bookings').select('*').eq('id', bookingId).maybeSingle(),
    supabaseAdmin.from('workers').select('id, name, code, active'),
    getAssignedWorkerIds(bookingId),
  ])
  if (!booking) throw new JobError('Reserva no encontrada', 404)

  const byId = new Map((workers || []).map((w) => [w.id, w]))
  const toAdd = wanted.filter((id) => !current.includes(id) && byId.get(id)?.active)
  const toRemove = current.filter((id) => !wanted.includes(id))
  const actor = getActorFromRequest(request)

  if (toRemove.length > 0) {
    const { error } = await supabaseAdmin.from('booking_workers').delete().eq('booking_id', booking.id).in('worker_id', toRemove)
    if (error) {
      console.error('[adminJobs] Error quitando de la cuadrilla:', error)
      throw new JobError('No se pudo guardar la cuadrilla', 500)
    }
  }
  if (toAdd.length > 0) {
    const { error } = await supabaseAdmin
      .from('booking_workers')
      .upsert(
        toAdd.map((worker_id) => ({ booking_id: booking.id, worker_id, assigned_by: actor?.username || null })),
        { onConflict: 'booking_id,worker_id' }
      )
    if (error) {
      console.error('[adminJobs] Error asignando a la cuadrilla:', error)
      throw new JobError('No se pudo guardar la cuadrilla', 500)
    }
  }

  const final = await getAssignedWorkerIds(booking.id)
  if (toAdd.length > 0 || toRemove.length > 0) {
    const names = (ids: string[]) => ids.map((id) => byId.get(id)?.name || id).join(', ') || null
    await logAdminAction({
      actor,
      action: 'booking.workers_changed',
      entityType: 'booking',
      entityId: booking.id,
      entityLabel: booking.code || booking.client_name || booking.id,
      summary: `Cambió la cuadrilla de la reserva ${booking.code || ''}`.trim(),
      changes: { cuadrilla: { from: names(current), to: names(final) } },
      request,
    })
    await notifyCrewChange({ booking, added: toAdd, removed: toRemove, createdBy: actor?.username })
  }
  return final
}

/** Asigna (o quita, con `null`) el camión de una reserva. Mismas reglas que al editarla. */
export async function setBookingVehicle(request: NextRequest, bookingId: string, vehicleId: unknown): Promise<number | null> {
  if (!UUID_RE.test(bookingId)) throw new JobError('Reserva no encontrada', 404)
  const target = vehicleId === null ? null : Number(vehicleId)
  if (target !== null && !Number.isInteger(target)) throw new JobError('Camión inválido')

  const [{ data: booking }, fleet] = await Promise.all([
    supabaseAdmin.from('bookings').select('*').eq('id', bookingId).maybeSingle(),
    getFleetVehicleViews(),
  ])
  if (!booking) throw new JobError('Reserva no encontrada', 404)
  if (target !== null) {
    const vehicle = fleet.find((v) => v.id === target)
    if (!vehicle) throw new JobError('El camión indicado no existe en la flota')
    if (vehicle.status === 'maintenance') {
      throw new JobError(`${vehicle.name} está en mantención: actívalo en Flota para asignarle trabajos`, 409)
    }
  }
  const previous: number | null = typeof booking.vehicle_id === 'number' ? booking.vehicle_id : null
  if (previous === target) return target

  const { error } = await supabaseAdmin.from('bookings').update({ vehicle_id: target }).eq('id', booking.id)
  if (error) {
    console.error('[adminJobs] Error cambiando el camión:', error)
    throw new JobError('No se pudo cambiar el camión', 500)
  }

  const actor = getActorFromRequest(request)
  const nameOf = (vid: number | null) => (vid == null ? 'Sin asignar' : fleet.find((v) => v.id === vid)?.name || `Camión ${vid}`)
  await logAdminAction({
    actor,
    action: 'booking.vehicle_assigned',
    entityType: 'booking',
    entityId: booking.id,
    entityLabel: [booking.client_name, booking.scheduled_date].filter(Boolean).join(' · ') || 'Reserva',
    summary: `Cambió el camión de ${nameOf(previous)} a ${nameOf(target)}`,
    changes: { vehicle_id: { from: previous, to: target } },
    request,
  })
  await notifyVehicleChange({ booking: { ...booking, vehicle_id: target }, from: previous, to: target, createdBy: actor?.username })
  return target
}

/** Marca o desmarca la hora fija de un trabajo (alerta en el panel del equipo). */
export async function setBookingFixedTime(request: NextRequest, bookingId: string, value: unknown): Promise<boolean> {
  if (!UUID_RE.test(bookingId)) throw new JobError('Reserva no encontrada', 404)
  const fixed = value === true
  const { data, error } = await supabaseAdmin.from('bookings').update({ fixed_time: fixed }).eq('id', bookingId).select('code, client_name').maybeSingle()
  if (error) throw new JobError('Falta correr la migración add_pendientes_oct.sql.', 409)
  if (!data) throw new JobError('Reserva no encontrada', 404)
  const label = [data.code, data.client_name].filter(Boolean).join(' · ') || 'trabajo'
  await logAdminAction({
    actor: getActorFromRequest(request),
    action: 'booking.fixed_time_changed',
    entityType: 'booking',
    entityId: bookingId,
    entityLabel: label,
    summary: `${fixed ? 'Marcó' : 'Quitó'} la hora fija de ${label}`,
    changes: { hora_fija: { from: !fixed, to: fixed } },
    request,
  })
  return fixed
}
