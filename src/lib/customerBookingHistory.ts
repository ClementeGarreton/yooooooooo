/**
 * Historial completo de una reserva para el panel del cliente (Tomás, 20-10-2026: «en mis
 * reservas, historial completo y full detalle de todo lo que el cliente solicitó + notas,
 * hasta el cierre»). Junta lo que pidió (la solicitud o la cotización), las notas, los datos
 * de la entrega, las diferencias aprobadas en terreno y los hitos con fecha, del envío al
 * cierre. No muestra quién del equipo hizo cada cosa: en el panel del cliente no se muestran
 * los usuarios internos.
 *
 * Solo se llama con una reserva que el cliente ya puede ver (la página lo comprueba antes).
 */

import { supabaseAdmin } from '@/lib/supabase'
import { SERVICE_TYPE_LABEL, type ServiceType } from '@/lib/serviceRequestTypes'

export interface BookingHistoryEvent {
  at: string
  label: string
  detail?: string | null
}

export interface BookingHistory {
  /** Lo que pidió desde «Nueva solicitud», si la reserva nació de una. */
  request: {
    code: string
    serviceLabel: string
    createdAt: string
    requestedDate: string
    requestedTime: string | null
    origin: string
    destination: string
    contact: string | null
    description: string
    volumeM3: number | null
    peopleNeeded: number | null
    pallets: number | null
    repalletize: boolean
    isPriority: boolean
  } | null
  /** Artículos de la cotización web. */
  items: { name: string; quantity: number }[]
  /** Servicios adicionales que eligió en la cotización. */
  extras: string[]
  notes: string | null
  /** Pallets, kilos, N° de OD y de guía anotados en la entrega. */
  delivery: { pallets: number | null; kg: number | null; odNumber: string | null; guideNumber: string | null; repalletize: boolean } | null
  /** Diferencias registradas en terreno y aprobadas. */
  differences: { field: string; original: string; found: string; priceDelta: number | null; at: string }[]
  events: BookingHistoryEvent[]
}

const EXTRA_LABEL: Record<string, string> = {
  packing: 'Embalaje',
  unpacking: 'Desembalaje',
  assembly: 'Armado',
  disassembly: 'Desarmado',
  cleaning: 'Limpieza',
  priority: 'Priority (agenda libre)',
  fridgeDisassembly: 'Desarmado de refrigerador',
}

const FIELD_LABEL: Record<string, string> = { bultos: 'Bultos', volumen: 'Volumen', horas: 'Horas', paradas: 'Paradas', otro: 'Otro' }

const STATUS_LABEL: Record<string, string> = {
  pending: 'Reserva pendiente',
  confirmed: 'Reserva confirmada',
  completed: 'Servicio completado',
  cancelled: 'Reserva cancelada',
  no_show: 'Servicio no realizado',
}

const clp = (n: number) => `$${Math.round(n).toLocaleString('es-CL')}`
const fmtDay = (d: string) => d.slice(0, 10).split('-').reverse().join('-')

export async function getBookingHistory(bookingId: string): Promise<BookingHistory | null> {
  const { data: booking } = await supabaseAdmin.from('bookings').select('*').eq('id', bookingId).maybeSingle()
  if (!booking) return null

  const none = Promise.resolve({ data: [] as any[] })
  const [requestResult, quoteResult, logsResult, paymentsResult, workResult, modsResult] = await Promise.all([
    supabaseAdmin.from('service_requests').select('*').eq('booking_id', bookingId).maybeSingle(),
    booking.quote_id
      ? supabaseAdmin
          .from('quote_prospects')
          .select('items_summary, additional_services, created_at')
          .or(`converted_booking_id.eq.${bookingId},quote_id.eq.${booking.quote_id}`)
          .limit(1)
      : supabaseAdmin.from('quote_prospects').select('items_summary, additional_services, created_at').eq('converted_booking_id', bookingId).limit(1),
    supabaseAdmin
      .from('admin_activity_log')
      .select('action, changes, created_at')
      .eq('entity_type', 'booking')
      .eq('entity_id', bookingId)
      .in('action', ['booking.rescheduled', 'booking.address_changed', 'booking.amount_adjusted', 'booking.status_changed', 'booking.vehicle_assigned', 'booking.workers_changed'])
      .order('created_at', { ascending: true })
      .limit(200),
    supabaseAdmin.from('booking_payments').select('amount, status, paid_at, created_at').eq('booking_id', bookingId).eq('status', 'approved'),
    supabaseAdmin.from('booking_work_logs').select('started_at, finished_at').eq('booking_id', bookingId),
    booking.id ? supabaseAdmin.from('booking_modifications').select('*').eq('booking_id', bookingId).eq('status', 'aprobada') : none,
  ])

  const req = requestResult.data as Record<string, any> | null
  const quote = ((quoteResult.data || []) as any[])[0] || null
  const events: BookingHistoryEvent[] = []

  if (req) {
    events.push({ at: req.created_at, label: `Solicitud ${req.code} enviada` })
    if (req.status === 'aprobada' && req.resolved_at) events.push({ at: req.resolved_at, label: 'Solicitud cotizada y aprobada' })
  } else if (quote?.created_at) {
    events.push({ at: quote.created_at, label: 'Cotización hecha' })
  }
  if (booking.created_at) events.push({ at: booking.created_at, label: 'Reserva creada' })

  let teamAssigned = false
  for (const log of (logsResult.data || []) as any[]) {
    const c = log.changes || {}
    if (log.action === 'booking.rescheduled') {
      const parts = [
        c.scheduled_date ? `fecha ${fmtDay(String(c.scheduled_date.from || ''))} → ${fmtDay(String(c.scheduled_date.to || ''))}` : null,
        c.scheduled_time ? `hora ${String(c.scheduled_time.from || '').slice(0, 5)} → ${String(c.scheduled_time.to || '').slice(0, 5)}` : null,
      ].filter(Boolean)
      events.push({ at: log.created_at, label: 'Fecha u hora cambiada', detail: parts.join(' · ') || null })
    } else if (log.action === 'booking.address_changed') {
      events.push({ at: log.created_at, label: 'Dirección actualizada' })
    } else if (log.action === 'booking.amount_adjusted') {
      events.push({ at: log.created_at, label: 'Monto del servicio ajustado' })
    } else if (log.action === 'booking.status_changed') {
      const to = c.status?.to
      if (to && STATUS_LABEL[to]) events.push({ at: log.created_at, label: STATUS_LABEL[to] })
    } else if (!teamAssigned) {
      teamAssigned = true
      events.push({ at: log.created_at, label: 'Equipo asignado' })
    }
  }

  for (const p of (paymentsResult.data || []) as any[]) {
    events.push({ at: p.paid_at || p.created_at, label: `Pago recibido: ${clp(Number(p.amount) || 0)}` })
  }

  const work = (workResult.data || []) as { started_at: string; finished_at: string | null }[]
  if (work.length > 0) {
    const start = work.map((w) => w.started_at).sort()[0]
    events.push({ at: start, label: 'El equipo inició el servicio' })
    const ends = work.map((w) => w.finished_at).filter((f): f is string => !!f).sort()
    if (ends.length > 0) events.push({ at: ends[ends.length - 1], label: 'El equipo terminó el servicio' })
  }

  const differences = ((modsResult.data || []) as any[]).map((m) => ({
    field: FIELD_LABEL[m.field] || m.field,
    original: m.original_value,
    found: m.found_value,
    priceDelta: m.price_delta ?? null,
    at: m.resolved_at || m.created_at,
  }))
  for (const d of differences) {
    events.push({
      at: d.at,
      label: `Diferencia en terreno aprobada: ${d.field}`,
      detail: `${d.original} → ${d.found}${d.priceDelta ? ` · ${d.priceDelta > 0 ? '+' : ''}${clp(d.priceDelta)}` : ''}`,
    })
  }

  if (booking.service_completed_at && !events.some((e) => e.label === STATUS_LABEL.completed)) {
    events.push({ at: booking.service_completed_at, label: STATUS_LABEL.completed })
  }
  if (booking.cancelled_at && !events.some((e) => e.label === STATUS_LABEL.cancelled)) {
    events.push({ at: booking.cancelled_at, label: STATUS_LABEL.cancelled })
  }
  events.sort((a, b) => a.at.localeCompare(b.at))

  const items = (Array.isArray(quote?.items_summary) ? quote.items_summary : [])
    .map((i: any) => ({ name: String(i?.name || ''), quantity: Number(i?.quantity) || 0 }))
    .filter((i: { name: string; quantity: number }) => i.name && i.quantity > 0)
  const extras = Object.entries((quote?.additional_services || {}) as Record<string, unknown>)
    .filter(([key, value]) => value === true && EXTRA_LABEL[key])
    .map(([key]) => EXTRA_LABEL[key])

  const hasDelivery = booking.pallets != null || booking.delivery_kg != null || booking.od_number || booking.guide_number || booking.repalletize
  return {
    request: req
      ? {
          code: req.code,
          serviceLabel: SERVICE_TYPE_LABEL[req.service_type as ServiceType] || req.service_type,
          createdAt: req.created_at,
          requestedDate: req.requested_date,
          requestedTime: req.requested_time,
          origin: req.origin_address,
          destination: req.destination_address,
          contact: req.contact,
          description: req.description,
          volumeM3: req.volume_m3 != null ? Number(req.volume_m3) : null,
          peopleNeeded: req.people_needed ?? null,
          pallets: req.pallets ?? null,
          repalletize: req.repalletize === true,
          isPriority: req.is_priority === true,
        }
      : null,
    items,
    extras,
    notes: typeof booking.notes === 'string' && booking.notes.trim() ? booking.notes.trim() : null,
    delivery: hasDelivery
      ? {
          pallets: booking.pallets ?? null,
          kg: booking.delivery_kg != null ? Number(booking.delivery_kg) : null,
          odNumber: booking.od_number || null,
          guideNumber: booking.guide_number || null,
          repalletize: booking.repalletize === true,
        }
      : null,
    differences,
    events,
  }
}
