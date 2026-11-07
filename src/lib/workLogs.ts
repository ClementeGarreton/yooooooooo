/**
 * INICIO Y FIN DE CADA TRABAJO, marcado por el trabajador desde su panel.
 *
 * Regla de Tomás (09-10-2026): el trabajador inicia el trabajo y lo finaliza antes de abrir
 * otro. Ve los trabajos futuros, pero con uno iniciado y sin finalizar no puede iniciar el
 * siguiente — salvo que confirme una advertencia, y en ese caso queda registrado que lo
 * inició con otro abierto. Cada marca guarda fecha y hora.
 *
 * Es por trabajador: en una cuadrilla cada uno marca lo suyo. No cambia el estado de la
 * reserva; eso lo sigue haciendo la oficina.
 *
 * Tabla `booking_work_logs` (add_operacion_terreno.sql). Sin ella, `available` es false y
 * el panel no muestra los botones.
 */

import { supabaseAdmin } from '@/lib/supabase'
import type { OpenWork, WorkLog } from '@/lib/workLogTypes'

export class WorkLogError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
    /** El trabajo que tiene abierto: el panel lo usa para pedir la confirmación. */
    public readonly open: OpenWork | null = null
  ) {
    super(message)
    this.name = 'WorkLogError'
  }
}

/** 42P01 / PGRST205 = falta correr add_operacion_terreno.sql. */
const isMissingTable = (error: { code?: string } | null | undefined) => error?.code === '42P01' || error?.code === 'PGRST205'

const toLog = (r: any): WorkLog => ({ bookingId: r.booking_id, startedAt: r.started_at, finishedAt: r.finished_at })

async function describeBooking(bookingId: string): Promise<string> {
  const { data } = await supabaseAdmin.from('bookings').select('code, client_name, scheduled_date').eq('id', bookingId).maybeSingle()
  const date = data?.scheduled_date ? String(data.scheduled_date).split('-').reverse().slice(0, 2).join('-') : null
  return [data?.code, data?.client_name, date].filter(Boolean).join(' · ') || 'otro trabajo'
}

/** Lo que el panel necesita: las marcas de estos trabajos y el que está abierto, si hay. */
export async function getWorkerWorkLogs(
  workerId: string,
  bookingIds: string[]
): Promise<{ available: boolean; logs: Map<string, WorkLog>; open: OpenWork | null }> {
  const { data: openRows, error } = await supabaseAdmin
    .from('booking_work_logs')
    .select('booking_id, started_at, finished_at')
    .eq('worker_id', workerId)
    .is('finished_at', null)
    .order('started_at', { ascending: true })
    .limit(1)
  if (error) {
    if (!isMissingTable(error)) console.error('[workLogs] Error leyendo el trabajo abierto:', error.message)
    return { available: false, logs: new Map(), open: null }
  }
  const { data: rows } = bookingIds.length
    ? await supabaseAdmin
        .from('booking_work_logs')
        .select('booking_id, started_at, finished_at')
        .eq('worker_id', workerId)
        .in('booking_id', bookingIds)
    : { data: [] as any[] }
  const first = openRows?.[0]
  return {
    available: true,
    logs: new Map((rows || []).map((r) => [r.booking_id, toLog(r)])),
    open: first ? { bookingId: first.booking_id, startedAt: first.started_at, label: await describeBooking(first.booking_id) } : null,
  }
}

/**
 * Inicia un trabajo. Con otro abierto responde 409 y dice cuál; con `force` (la persona ya
 * leyó la advertencia) lo inicia igual y lo deja anotado.
 */
export async function startWork(
  worker: { id: string; name: string; code: string },
  bookingId: string,
  force: boolean
): Promise<WorkLog> {
  const { data: mine, error } = await supabaseAdmin
    .from('booking_work_logs')
    .select('booking_id, started_at, finished_at')
    .eq('worker_id', worker.id)
  if (error) {
    if (isMissingTable(error)) throw new WorkLogError('Todavía no se puede marcar el inicio. Avísale a la oficina.', 503)
    throw error
  }
  const rows = mine || []
  if (rows.some((r) => r.booking_id === bookingId)) throw new WorkLogError('Este trabajo ya lo iniciaste.', 409)

  const open = rows
    .filter((r) => !r.finished_at)
    .sort((a, b) => String(a.started_at).localeCompare(String(b.started_at)))[0]
  if (open && !force) {
    const label = await describeBooking(open.booking_id)
    throw new WorkLogError(`Tienes un trabajo sin finalizar: ${label}.`, 409, {
      bookingId: open.booking_id,
      startedAt: open.started_at,
      label,
    })
  }

  const { data, error: insertError } = await supabaseAdmin
    .from('booking_work_logs')
    .insert({
      booking_id: bookingId,
      worker_id: worker.id,
      worker_label: `${worker.name} · ${worker.code}`,
      started_with_open: Boolean(open),
      open_booking_id: open?.booking_id || null,
    })
    .select('booking_id, started_at, finished_at')
    .single()
  if (insertError) {
    // Doble toque: la restricción única deja pasar uno solo.
    if (insertError.code === '23505') throw new WorkLogError('Este trabajo ya lo iniciaste.', 409)
    throw insertError
  }
  return toLog(data)
}

/** Finaliza un trabajo iniciado. La condición va en el UPDATE: un doble toque no pisa la hora. */
export async function finishWork(workerId: string, bookingId: string): Promise<WorkLog> {
  // Trabajo de pallets (Tomás, 20-10-2026): sin N° de guía de despacho o factura no se cierra.
  // `*`: service_type y guide_number son de migraciones que pueden no estar corridas.
  const { data: booking } = await supabaseAdmin.from('bookings').select('*').eq('id', bookingId).maybeSingle()
  if (booking?.service_type === 'pallets' && !String(booking.guide_number || '').trim()) {
    throw new WorkLogError('Antes de finalizar, anota el N° de guía de despacho o de factura en «Entrega».', 409)
  }
  const { data, error } = await supabaseAdmin
    .from('booking_work_logs')
    .update({ finished_at: new Date().toISOString() })
    .eq('worker_id', workerId)
    .eq('booking_id', bookingId)
    .is('finished_at', null)
    .select('booking_id, started_at, finished_at')
    .maybeSingle()
  if (error) {
    if (isMissingTable(error)) throw new WorkLogError('Todavía no se puede marcar el fin. Avísale a la oficina.', 503)
    throw error
  }
  if (!data) throw new WorkLogError('Este trabajo no está iniciado o ya lo finalizaste.', 409)
  return toLog(data)
}

/** Para el historial de la reserva en el admin: quién inició y finalizó, y cuándo. */
export async function getBookingWorkLogs(bookingId: string): Promise<
  { workerLabel: string; startedAt: string; finishedAt: string | null; startedWithOpen: boolean }[]
> {
  const { data, error } = await supabaseAdmin
    .from('booking_work_logs')
    .select('worker_label, started_at, finished_at, started_with_open')
    .eq('booking_id', bookingId)
    .order('started_at', { ascending: true })
  if (error) return []
  return (data || []).map((r) => ({
    workerLabel: r.worker_label,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    startedWithOpen: Boolean(r.started_with_open),
  }))
}
