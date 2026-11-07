/**
 * Avisos a los trabajadores (tabla `worker_notifications`, add_worker_notifications.sql).
 *
 * Se escribe un aviso cuando a alguien le toca un trabajo —porque lo pusieron en la
 * cuadrilla o porque el trabajo quedó en su camión habitual—, cuando se lo quitan, y
 * cuando un trabajo suyo se reprograma o se cancela. Se leen en `/trabajos` → «Avisos», y
 * a quien tiene correo en su ficha le llegan también por correo (Resend, sin n8n).
 *
 * NADA de acá puede botar la operación que lo dispara: si la tabla no existe o el insert
 * falla, se deja un warning y la asignación sigue. Los textos no llevan precios.
 */

import { supabaseAdmin } from '@/lib/supabase'
import { isValidEmail } from '@/lib/emailFormat'
import { resendConfigured, sendResendEmail } from '@/lib/resendClient'
import type { WorkerNotification, WorkerNotificationKind } from '@/lib/workerNotificationTypes'
import { siteUrl } from '@/lib/siteUrl'

const TITLES: Record<WorkerNotificationKind, string> = {
  assigned: 'Nuevo trabajo asignado',
  removed: 'Ya no vas a este trabajo',
  rescheduled: 'Un trabajo cambió de fecha u hora',
  cancelled: 'Un trabajo se canceló',
}

function chileToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date())
}

const fmtDate = (d?: string | null) => (d ? String(d).slice(0, 10).split('-').reverse().join('-') : 'sin fecha')
const fmtTime = (t?: string | null) => (t ? String(t).slice(0, 5) : '')

/** «06-10-2026 09:00 · Cliente · Origen → Destino». Sin precios. */
function describeBooking(b: Record<string, any>): string {
  const when = [fmtDate(b.scheduled_date), fmtTime(b.scheduled_time)].filter(Boolean).join(' ')
  const route = b.visit_address
    ? String(b.visit_address)
    : [b.origin_address, b.destination_address].filter(Boolean).join(' → ')
  return [when, b.client_name, route].filter(Boolean).join(' · ')
}

/** ¿Vale la pena avisar de esta reserva? Solo trabajos reales de hoy en adelante. */
function isNotifiable(b: Record<string, any> | null | undefined): boolean {
  return Boolean(
    b &&
      !b.is_provisional &&
      !String(b.quote_id || '').startsWith('ADMIN-BLOQUEO-') &&
      String(b.scheduled_date || '') >= chileToday()
  )
}

async function insertNotifications(
  rows: Array<{ worker_id: string; booking_id: string; kind: WorkerNotificationKind; body: string }>,
  createdBy?: string | null
): Promise<void> {
  if (rows.length === 0) return
  const { data, error } = await supabaseAdmin
    .from('worker_notifications')
    .insert(rows.map((r) => ({ ...r, title: TITLES[r.kind], created_by: createdBy || null })))
    .select('id, worker_id, kind, title, body')
  if (error) {
    console.warn('[workerNotifications] No se guardaron avisos (¿falta add_worker_notifications.sql?):', error.message)
    return
  }
  await emailNotifications((data || []) as SavedNotification[])
}

type SavedNotification = { id: string; worker_id: string; kind: WorkerNotificationKind; title: string; body: string | null }

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * El mismo aviso, por correo, a quien tenga correo en su ficha. Sale directo por Resend
 * (resendClient.ts). El aviso del panel ya quedó guardado: si el correo falla, no se pierde
 * nada y el resultado queda anotado en la fila (`email_status`).
 */
async function emailNotifications(saved: SavedNotification[]): Promise<void> {
  if (saved.length === 0 || !resendConfigured()) return
  // `email` es de add_worker_email.sql: si la columna no existe, no hay a quién escribir.
  const { data: workers, error } = await supabaseAdmin
    .from('workers')
    .select('id, name, email')
    .in('id', Array.from(new Set(saved.map((n) => n.worker_id))))
  if (error) return
  const byId = new Map(((workers || []) as { id: string; name: string; email: string | null }[]).map((w) => [w.id, w]))
  const panelUrl = `${siteUrl()}/trabajos`

  await Promise.allSettled(
    saved.map(async (n) => {
      const worker = byId.get(n.worker_id)
      if (!worker?.email || !isValidEmail(worker.email)) return
      const firstName = worker.name.split(' ')[0]
      const detail = n.body || ''
      const result = await sendResendEmail({
        to: worker.email,
        subject: `${n.title} · Yo me encargo`,
        text: `Hola ${firstName}:\n\n${n.title}.\n${detail}\n\nEl detalle está en tu panel: ${panelUrl}\n`,
        html:
          `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#1f2937">` +
          `<div style="background:#1B3A5C;color:#fff;padding:16px 20px;border-radius:12px 12px 0 0;font-weight:bold">Yo me encargo · Mi equipo</div>` +
          `<div style="border:1px solid #e5e7eb;border-top:0;padding:20px;border-radius:0 0 12px 12px">` +
          `<p style="margin:0 0 8px">Hola ${escapeHtml(firstName)}:</p>` +
          `<p style="margin:0 0 8px;font-size:18px;font-weight:bold">${escapeHtml(n.title)}</p>` +
          `<p style="margin:0 0 16px;color:#4b5563">${escapeHtml(detail)}</p>` +
          `<a href="${panelUrl}" style="display:inline-block;background:#2C5282;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:bold">Ver en mi panel</a>` +
          `</div></div>`,
        idempotencyKey: `worker-notification/${n.id}`,
      })
      const { error: updateError } = await supabaseAdmin
        .from('worker_notifications')
        .update(
          result.ok
            ? { email_status: 'sent', emailed_at: new Date().toISOString() }
            : { email_status: result.reason === 'error' ? 'failed' : `skipped:${result.reason}`, email_error: result.error || null }
        )
        .eq('id', n.id)
      if (updateError) console.warn('[workerNotifications] No se anotó el resultado del correo:', updateError.message)
    })
  )
}

/** Trabajadores activos cuyo camión habitual es este. */
export async function habitualWorkerIds(vehicleId: number | null | undefined): Promise<string[]> {
  if (typeof vehicleId !== 'number') return []
  const { data } = await supabaseAdmin.from('workers').select('id').eq('vehicle_id', vehicleId).eq('active', true)
  return (data || []).map((w) => w.id)
}

async function crewWorkerIds(bookingId: string): Promise<string[]> {
  const { data } = await supabaseAdmin.from('booking_workers').select('worker_id').eq('booking_id', bookingId)
  return (data || []).map((r) => r.worker_id)
}

/** Avisa a estos trabajadores sobre una reserva. `extra` se agrega al texto. */
export async function notifyWorkers(
  workerIds: string[],
  kind: WorkerNotificationKind,
  booking: Record<string, any> | null | undefined,
  options: { extra?: string; createdBy?: string | null } = {}
): Promise<void> {
  try {
    const ids = Array.from(new Set(workerIds))
    if (ids.length === 0 || !booking?.id || !isNotifiable(booking)) return
    const body = [describeBooking(booking), options.extra].filter(Boolean).join(' — ')
    await insertNotifications(
      ids.map((worker_id) => ({ worker_id, booking_id: booking.id, kind, body })),
      options.createdBy
    )
  } catch (error) {
    console.warn('[workerNotifications] Error avisando:', error)
  }
}

/**
 * La cuadrilla de una reserva cambió. Al que ya la veía por su camión habitual no se le
 * avisa de nuevo (ni se le dice que la perdió si la sigue viendo por el camión).
 */
export async function notifyCrewChange(args: {
  booking: Record<string, any>
  added: string[]
  removed: string[]
  createdBy?: string | null
}): Promise<void> {
  try {
    const habitual = new Set(await habitualWorkerIds(args.booking.vehicle_id))
    await notifyWorkers(args.added.filter((id) => !habitual.has(id)), 'assigned', args.booking, { createdBy: args.createdBy })
    await notifyWorkers(args.removed.filter((id) => !habitual.has(id)), 'removed', args.booking, { createdBy: args.createdBy })
  } catch (error) {
    console.warn('[workerNotifications] Error avisando cambio de cuadrilla:', error)
  }
}

/** Una reserva cambió de camión: avisa a los habituales del nuevo y a los del anterior. */
export async function notifyVehicleChange(args: {
  booking: Record<string, any>
  from: number | null | undefined
  to: number | null | undefined
  createdBy?: string | null
}): Promise<void> {
  try {
    if ((args.from ?? null) === (args.to ?? null)) return
    const [crew, incoming, outgoing] = await Promise.all([
      crewWorkerIds(args.booking.id),
      habitualWorkerIds(args.to),
      habitualWorkerIds(args.from),
    ])
    const stillSee = new Set([...crew, ...incoming])
    await notifyWorkers(incoming.filter((id) => !crew.includes(id)), 'assigned', args.booking, { createdBy: args.createdBy })
    await notifyWorkers(outgoing.filter((id) => !stillSee.has(id)), 'removed', args.booking, { createdBy: args.createdBy })
  } catch (error) {
    console.warn('[workerNotifications] Error avisando cambio de camión:', error)
  }
}

/**
 * Después de editar una reserva en el panel: cambio de camión, reprogramación o
 * cancelación. `before` / `after` son las filas completas de antes y después.
 */
export async function notifyWorkersOfBookingUpdate(args: {
  before: Record<string, any> | null
  after: Record<string, any> | null
  createdBy?: string | null
}): Promise<void> {
  const { before, after, createdBy } = args
  if (!before || !after?.id) return
  try {
    const wasLive = !['cancelled', 'no_show'].includes(before.status || '')
    const isLive = !['cancelled', 'no_show'].includes(after.status || '')
    const everyone = async () =>
      Array.from(new Set([...(await crewWorkerIds(after.id)), ...(await habitualWorkerIds(after.vehicle_id))]))

    if (wasLive && !isLive) {
      await notifyWorkers(await everyone(), 'cancelled', after, { createdBy })
      return
    }
    if (!isLive) return

    if ((before.vehicle_id ?? null) !== (after.vehicle_id ?? null)) {
      await notifyVehicleChange({ booking: after, from: before.vehicle_id, to: after.vehicle_id, createdBy })
    }
    if (before.scheduled_date !== after.scheduled_date || fmtTime(before.scheduled_time) !== fmtTime(after.scheduled_time)) {
      await notifyWorkers(await everyone(), 'rescheduled', after, {
        extra: `antes era el ${[fmtDate(before.scheduled_date), fmtTime(before.scheduled_time)].filter(Boolean).join(' ')}`,
        createdBy,
      })
    }
  } catch (error) {
    console.warn('[workerNotifications] Error avisando cambio de reserva:', error)
  }
}

/** El reparto automático le puso camión a estas reservas: avisa a los habituales de cada camión. */
export async function notifyAutoAssigned(writes: Array<{ id: string; vehicle_id: number }>): Promise<void> {
  try {
    if (writes.length === 0) return
    const vehicleIds = Array.from(new Set(writes.map((w) => w.vehicle_id)))
    const { data: workers } = await supabaseAdmin
      .from('workers')
      .select('id, vehicle_id')
      .in('vehicle_id', vehicleIds)
      .eq('active', true)
    if (!workers || workers.length === 0) return
    const { data: bookings } = await supabaseAdmin
      .from('bookings')
      .select('*')
      .in('id', writes.map((w) => w.id))
    const byId = new Map(((bookings || []) as Record<string, any>[]).map((b) => [b.id, b]))
    const rows: Array<{ worker_id: string; booking_id: string; kind: WorkerNotificationKind; body: string }> = []
    for (const w of writes) {
      const booking = byId.get(w.id)
      if (!isNotifiable(booking)) continue
      for (const worker of workers) {
        if (worker.vehicle_id === w.vehicle_id) {
          rows.push({ worker_id: worker.id, booking_id: w.id, kind: 'assigned', body: describeBooking(booking!) })
        }
      }
    }
    await insertNotifications(rows, 'reparto automático')
  } catch (error) {
    console.warn('[workerNotifications] Error avisando reparto automático:', error)
  }
}

// ───────────────────────── Lectura (panel del trabajador) ─────────────────────────

export async function getWorkerNotifications(workerId: string, limit = 50): Promise<WorkerNotification[]> {
  const { data, error } = await supabaseAdmin
    .from('worker_notifications')
    .select('id, booking_id, kind, title, body, created_at, read_at')
    .eq('worker_id', workerId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) return []
  return (data || []) as WorkerNotification[]
}

export async function countUnreadWorkerNotifications(workerId: string): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from('worker_notifications')
    .select('id', { count: 'exact', head: true })
    .eq('worker_id', workerId)
    .is('read_at', null)
  return error ? 0 : count || 0
}

export async function markWorkerNotificationsRead(workerId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('worker_notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('worker_id', workerId)
    .is('read_at', null)
  if (error) console.warn('[workerNotifications] No se pudieron marcar como leídos:', error.message)
}
