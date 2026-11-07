/**
 * Modificaciones en terreno (etapa 2, paso 6 / Módulo 4).
 *
 * El trabajador registra la diferencia entre lo cotizado y lo que encuentra. Queda
 * pendiente; la administración la aprueba —y ahí FIJA el ajuste de precio, que puede ser
 * $0— o la rechaza. Nada cambia en la reserva sin esa aprobación, y el dato cotizado no
 * se pisa: la reserva conserva `original_price` y el ajuste va a `adjusted_price`, el
 * mismo campo que usa el reajuste manual del panel.
 */

import { approvalsUrl, notifyTeam } from '@/lib/teamNotices'
import { getBookingWorkLogs } from '@/lib/workLogs'
import { supabaseAdmin } from '@/lib/supabase'
import { servicePrice } from '@/lib/revenueBreakdown'
import {
  MODIFICATION_FIELDS,
  MODIFICATION_FIELD_LABEL,
  type AdminModification,
  type HistoryEvent,
  type ModificationField,
  type ModificationStatus,
  type WorkerModification,
} from '@/lib/bookingModificationTypes'

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Tope de diferencias pendientes por trabajo: frena un formulario enviado diez veces. */
const MAX_PENDING_PER_BOOKING = 10
/** Tope del ajuste que se puede fijar de una vez: evita un cero de más al teclear. */
const MAX_PRICE_DELTA = 5_000_000

const FIELDS = `id, booking_id, worker_id, worker_label, field, original_value, found_value, note, status,
  price_delta, price_before, price_after, resolved_by, resolved_at, resolution_note, created_at`

interface Row {
  id: string
  booking_id: string
  worker_id: string | null
  worker_label: string
  field: ModificationField
  original_value: string
  found_value: string
  note: string
  status: ModificationStatus
  price_delta: number | null
  price_before: number | null
  price_after: number | null
  resolved_by: string | null
  resolved_at: string | null
  resolution_note: string | null
  created_at: string
}

export class ModificationError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message)
    this.name = 'ModificationError'
  }
}

/** 42P01 / PGRST205 = falta correr add_booking_modifications.sql. */
export function isMissingModificationsTable(error: { code?: string } | null | undefined): boolean {
  return error?.code === '42P01' || error?.code === 'PGRST205'
}

const toWorkerView = (r: Row): WorkerModification => ({
  id: r.id,
  bookingId: r.booking_id,
  field: r.field,
  originalValue: r.original_value,
  foundValue: r.found_value,
  note: r.note,
  status: r.status,
  createdAt: r.created_at,
})

const clean = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : ''

/** «bultos: 4 → 5», para resúmenes y comentarios. */
export function describeChange(m: { field: ModificationField; originalValue: string; foundValue: string }): string {
  return `${MODIFICATION_FIELD_LABEL[m.field].toLowerCase()}: ${m.originalValue} → ${m.foundValue}`
}

/**
 * Registra una diferencia. El llamador YA verificó que el trabajo está en la agenda del
 * trabajador (misma regla que las notas y las subidas).
 */
export async function createModification(
  worker: { id: string; name: string; code: string },
  bookingId: string,
  body: any
): Promise<WorkerModification> {
  const field = MODIFICATION_FIELDS.find((f) => f.value === body?.field)?.value
  if (!field) throw new ModificationError('Elige qué dato cambió.')
  const original = clean(body?.original, 120)
  const found = clean(body?.found, 120)
  if (!original || !found) throw new ModificationError('Escribe lo cotizado y lo que encontraste.')
  if (original === found) throw new ModificationError('Lo cotizado y lo encontrado son iguales.')
  const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 1000) : ''
  if (note.length < 3) throw new ModificationError('Escribe el motivo: es lo que va a leer quien aprueba.')

  const { count, error: countError } = await supabaseAdmin
    .from('booking_modifications')
    .select('id', { count: 'exact', head: true })
    .eq('booking_id', bookingId)
    .eq('status', 'pendiente')
  if (countError) {
    if (isMissingModificationsTable(countError)) {
      throw new ModificationError('Todavía no se pueden registrar diferencias. Avísale a la oficina.', 503)
    }
    throw countError
  }
  if ((count || 0) >= MAX_PENDING_PER_BOOKING) {
    throw new ModificationError('Este trabajo ya tiene varias diferencias esperando aprobación.', 429)
  }

  const { data, error } = await supabaseAdmin
    .from('booking_modifications')
    .insert({
      booking_id: bookingId,
      worker_id: worker.id,
      worker_label: `${worker.name} · ${worker.code}`,
      field,
      original_value: original,
      found_value: found,
      note,
    })
    .select(FIELDS)
    .single()
  if (error) throw error

  // Aviso al equipo: la diferencia ya quedó en «Por aprobar» aunque el correo no salga.
  const { data: booking } = await supabaseAdmin
    .from('bookings')
    .select('code, client_name, scheduled_date')
    .eq('id', bookingId)
    .maybeSingle()
  await notifyTeam({
    label: 'modificacion-pendiente',
    key: `booking-modification/${(data as any).id}`,
    subject: `Diferencia en terreno ${booking?.code || ''}: ${MODIFICATION_FIELD_LABEL[field]} ${original} -> ${found}`.replace(/\s+/g, ' '),
    lines: [
      `${worker.name} (${worker.code}) registro una diferencia con lo cotizado y espera aprobacion.`,
      '',
      `Reserva: ${[booking?.code, booking?.client_name, booking?.scheduled_date].filter(Boolean).join(' - ')}`,
      `Dato: ${MODIFICATION_FIELD_LABEL[field]}`,
      `Cotizado: ${original}`,
      `Encontrado: ${found}`,
      `Motivo: ${note}`,
      '',
      `Se aprueba, rechaza o ajusta en el panel, pestaña Por aprobar: ${approvalsUrl()}`,
    ],
  })
  return toWorkerView(data as unknown as Row)
}

/** Lo que registró un trabajador en un conjunto de trabajos, por reserva. Sin precios. */
export async function getWorkerModifications(
  workerId: string,
  bookingIds: string[]
): Promise<Map<string, WorkerModification[]>> {
  const out = new Map<string, WorkerModification[]>()
  if (bookingIds.length === 0) return out
  const { data, error } = await supabaseAdmin
    .from('booking_modifications')
    .select(FIELDS)
    .eq('worker_id', workerId)
    .in('booking_id', bookingIds)
    .order('created_at', { ascending: true })
  if (error) {
    if (!isMissingModificationsTable(error)) console.error('[modifications] Error leyendo:', error)
    return out
  }
  for (const row of (data || []) as unknown as Row[]) {
    out.set(row.booking_id, [...(out.get(row.booking_id) || []), toWorkerView(row)])
  }
  return out
}

const BOOKING_FIELDS =
  'id, code, quote_id, client_name, scheduled_date, scheduled_time, origin_address, destination_address, total_price, original_price, adjusted_price, adjustment_comment'

async function toAdminViews(rows: Row[]): Promise<AdminModification[]> {
  if (rows.length === 0) return []
  const ids = Array.from(new Set(rows.map((r) => r.booking_id)))
  const { data: bookings } = await supabaseAdmin.from('bookings').select(BOOKING_FIELDS).in('id', ids)
  const byId = new Map((bookings || []).map((b: any) => [b.id, b]))
  return rows.map((r) => {
    const b: any = byId.get(r.booking_id)
    return {
      ...toWorkerView(r),
      workerLabel: r.worker_label,
      priceDelta: r.price_delta,
      priceBefore: r.price_before,
      priceAfter: r.price_after,
      resolvedBy: r.resolved_by,
      resolvedAt: r.resolved_at,
      resolutionNote: r.resolution_note,
      booking: b
        ? {
            id: b.id,
            code: b.code,
            quoteId: b.quote_id,
            clientName: b.client_name,
            scheduledDate: b.scheduled_date,
            scheduledTime: b.scheduled_time,
            origin: b.origin_address,
            destination: b.destination_address,
            price: servicePrice(b),
          }
        : null,
    }
  })
}

/** Bandeja del admin: pendientes (las más viejas primero) y resueltas recientes. */
export async function listAdminModifications(): Promise<{
  available: boolean
  modifications: AdminModification[]
  pending: number
}> {
  const [pending, resolved] = await Promise.all([
    supabaseAdmin.from('booking_modifications').select(FIELDS).eq('status', 'pendiente').order('created_at', { ascending: true }).limit(200),
    supabaseAdmin.from('booking_modifications').select(FIELDS).neq('status', 'pendiente').order('resolved_at', { ascending: false }).limit(50),
  ])
  const error = pending.error || resolved.error
  if (error) {
    if (!isMissingModificationsTable(error)) console.error('[modifications] Error en la bandeja:', error)
    return { available: !isMissingModificationsTable(error), modifications: [], pending: 0 }
  }
  const rows = [...(pending.data || []), ...(resolved.data || [])] as unknown as Row[]
  return { available: true, modifications: await toAdminViews(rows), pending: (pending.data || []).length }
}

/**
 * Aprueba (fijando el ajuste de precio) o rechaza una modificación pendiente.
 *
 * Primero se toma la modificación con `status = pendiente` en el UPDATE —si dos personas
 * resuelven a la vez, gana una— y recién después se toca el precio de la reserva. Si eso
 * último falla, la modificación vuelve a pendiente: nunca queda «aprobada» sin su ajuste.
 */
export async function resolveModification(
  modificationId: string,
  input: { action: 'approve' | 'reject'; priceDelta?: unknown; note?: unknown },
  actorUsername: string
): Promise<{ modification: AdminModification; priceChanged: boolean }> {
  if (!UUID_RE.test(modificationId)) throw new ModificationError('Modificación no encontrada', 404)
  const note = typeof input.note === 'string' ? input.note.trim().slice(0, 500) : ''

  const { data: current } = await supabaseAdmin.from('booking_modifications').select(FIELDS).eq('id', modificationId).maybeSingle()
  if (!current) throw new ModificationError('Modificación no encontrada', 404)
  const row = current as unknown as Row
  if (row.status !== 'pendiente') throw new ModificationError('Esa modificación ya fue resuelta.', 409)

  if (input.action === 'reject') {
    if (note.length < 3) throw new ModificationError('Escribe el motivo del rechazo.')
    const { data, error } = await supabaseAdmin
      .from('booking_modifications')
      .update({ status: 'rechazada', resolved_by: actorUsername, resolved_at: new Date().toISOString(), resolution_note: note })
      .eq('id', modificationId)
      .eq('status', 'pendiente')
      .select(FIELDS)
      .maybeSingle()
    if (error) throw error
    if (!data) throw new ModificationError('Esa modificación ya fue resuelta.', 409)
    const [view] = await toAdminViews([data as unknown as Row])
    return { modification: view, priceChanged: false }
  }

  const delta = Math.round(Number(input.priceDelta ?? 0))
  if (!Number.isFinite(delta) || Math.abs(delta) > MAX_PRICE_DELTA) {
    throw new ModificationError('El ajuste de precio no es válido.')
  }
  const { data: booking } = await supabaseAdmin.from('bookings').select(BOOKING_FIELDS).eq('id', row.booking_id).maybeSingle()
  if (!booking) throw new ModificationError('La reserva de esta modificación ya no existe.', 404)
  const before = servicePrice(booking as any)
  const after = before + delta
  if (after < 0) throw new ModificationError('El ajuste deja el servicio con precio negativo.')

  const { data: claimed, error: claimError } = await supabaseAdmin
    .from('booking_modifications')
    .update({
      status: 'aprobada',
      price_delta: delta,
      price_before: before,
      price_after: after,
      resolved_by: actorUsername,
      resolved_at: new Date().toISOString(),
      resolution_note: note || null,
    })
    .eq('id', modificationId)
    .eq('status', 'pendiente')
    .select(FIELDS)
    .maybeSingle()
  if (claimError) throw claimError
  if (!claimed) throw new ModificationError('Esa modificación ya fue resuelta.', 409)

  if (delta !== 0) {
    const change = describeChange({ field: row.field, originalValue: row.original_value, foundValue: row.found_value })
    const previous = String((booking as any).adjustment_comment || '').trim()
    const comment = [`Modificación en terreno aprobada (${change}): ${row.note}`, previous].filter(Boolean).join(' | ').slice(0, 1000)
    const { error: priceError } = await supabaseAdmin
      .from('bookings')
      .update({
        adjusted_price: after,
        adjustment_comment: comment,
        adjusted_at: new Date().toISOString(),
        adjusted_by: actorUsername,
      })
      .eq('id', row.booking_id)
    if (priceError) {
      console.error('[modifications] Error ajustando el precio, se revierte la aprobación:', priceError)
      await supabaseAdmin
        .from('booking_modifications')
        .update({ status: 'pendiente', price_delta: null, price_before: null, price_after: null, resolved_by: null, resolved_at: null, resolution_note: null })
        .eq('id', modificationId)
      throw new ModificationError('No se pudo ajustar el precio de la reserva. La modificación sigue pendiente.', 500)
    }
  }

  const [view] = await toAdminViews([claimed as unknown as Row])
  return { modification: view, priceChanged: delta !== 0 }
}

const clp = (n: number) => `$${Math.round(n).toLocaleString('es-CL')}`

/**
 * Historial de una reserva para el admin: la solicitud que le dio origen (si la hubo), lo
 * que quedó en Actividad (cada cambio con su usuario) y las modificaciones en terreno con
 * quién las registró y quién las resolvió. Del más antiguo al más nuevo.
 */
export async function getBookingHistory(bookingId: string): Promise<HistoryEvent[]> {
  if (!UUID_RE.test(bookingId)) return []
  const [logs, modifications, request] = await Promise.all([
    supabaseAdmin
      .from('admin_activity_log')
      .select('action, summary, actor_username, created_at')
      .eq('entity_type', 'booking')
      .eq('entity_id', bookingId)
      .order('created_at', { ascending: true })
      .limit(300),
    supabaseAdmin.from('booking_modifications').select(FIELDS).eq('booking_id', bookingId).order('created_at', { ascending: true }),
    supabaseAdmin.from('service_requests').select('code, created_at, resolved_at, resolved_by, customer_id').eq('booking_id', bookingId).maybeSingle(),
  ])

  const events: HistoryEvent[] = []
  // Cupón usado al reservar: explica por qué el precio de la reserva es menor al cotizado.
  const { data: redemption } = await supabaseAdmin
    .from('coupon_redemptions')
    .select('amount_before, discount, amount_after, created_at, coupons(code)')
    .eq('booking_id', bookingId)
    .maybeSingle()
  if (redemption) {
    const code = (redemption as any).coupons?.code || 'cupón'
    events.push({
      at: redemption.created_at,
      title: `Reservó con el cupón ${code}: ${clp(redemption.amount_before)} − ${clp(redemption.discount)} = ${clp(redemption.amount_after)}`,
      by: 'cliente',
      kind: 'request',
    })
  }
  if (request.data) {
    events.push({ at: request.data.created_at, title: `Solicitud ${request.data.code} creada`, by: 'cliente', kind: 'request' })
    if (request.data.resolved_at) {
      events.push({ at: request.data.resolved_at, title: `Solicitud ${request.data.code} aprobada`, by: request.data.resolved_by, kind: 'request' })
    }
  }
  for (const log of logs.data || []) {
    // La resolución de una modificación ya sale abajo, con su detalle: no se repite.
    if (String(log.action).startsWith('booking.modification_')) continue
    events.push({ at: log.created_at, title: log.summary, by: log.actor_username, kind: 'log' })
  }
  // Inicio y fin marcados por cada trabajador (vacío si falta add_operacion_terreno.sql).
  for (const w of await getBookingWorkLogs(bookingId)) {
    events.push({
      at: w.startedAt,
      title: w.startedWithOpen ? 'Trabajo iniciado (con otro trabajo sin finalizar)' : 'Trabajo iniciado',
      by: w.workerLabel,
      kind: 'log',
    })
    if (w.finishedAt) events.push({ at: w.finishedAt, title: 'Trabajo finalizado', by: w.workerLabel, kind: 'log' })
  }
  for (const m of ((modifications.data || []) as unknown as Row[])) {
    const change = describeChange({ field: m.field, originalValue: m.original_value, foundValue: m.found_value })
    events.push({
      at: m.created_at,
      title: `Modificación registrada — ${change}`,
      by: `${m.worker_label} · trabajador`,
      detail: m.note,
      kind: 'modification',
    })
    if (m.status !== 'pendiente' && m.resolved_at) {
      const price =
        m.status === 'aprobada'
          ? m.price_delta
            ? ` · ${m.price_delta > 0 ? '+' : '−'}${clp(Math.abs(m.price_delta))} (${clp(m.price_before || 0)} → ${clp(m.price_after || 0)})`
            : ' · sin cambio de precio'
          : ''
      events.push({
        at: m.resolved_at,
        title: `Modificación ${m.status} — ${change}${price}`,
        by: m.resolved_by,
        detail: m.resolution_note,
        kind: 'modification',
      })
    }
  }
  return events.sort((a, b) => a.at.localeCompare(b.at))
}
