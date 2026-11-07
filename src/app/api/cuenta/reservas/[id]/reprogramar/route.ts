import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { customerIdFromRequest } from '@/lib/customerSession'
import { getOwnedBookingForReschedule } from '@/lib/customerAccount'
import {
  rescheduleBlock,
  rescheduleBooking,
  rescheduleDates,
  rescheduleSlots,
} from '@/lib/customerReschedule'
import { logAdminAction } from '@/lib/activityLog'

export const dynamic = 'force-dynamic'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Opciones para reprogramar una reserva del cliente de la sesión.
 *  - Sin `date`: si se puede reprogramar y qué días se ofrecen (con los de más recargo
 *    marcados como no permitidos).
 *  - Con `date`: los horarios de ese día, con cupo y respetando las 48 horas.
 * Una reserva ajena responde 404, igual que una inexistente.
 */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const customerId = await customerIdFromRequest(request)
  if (!customerId) return NextResponse.json({ error: 'Tu sesión venció. Vuelve a entrar.' }, { status: 401 })

  const booking = await getOwnedBookingForReschedule(customerId, params.id)
  if (!booking) return NextResponse.json({ error: 'Reserva no encontrada' }, { status: 404 })

  const block = rescheduleBlock(booking)
  if (block) return NextResponse.json({ canReschedule: false, reason: block })

  try {
    const date = request.nextUrl.searchParams.get('date')
    if (date) {
      if (!DATE_RE.test(date)) return NextResponse.json({ error: 'Fecha inválida' }, { status: 400 })
      return NextResponse.json({ slots: await rescheduleSlots(booking.id, date) })
    }
    return NextResponse.json({
      canReschedule: true,
      current: { date: booking.scheduled_date, time: String(booking.scheduled_time).slice(0, 5) },
      dates: await rescheduleDates(String(booking.scheduled_date)),
    })
  } catch (error) {
    console.error('[cuenta/reprogramar] Error armando las opciones:', error)
    return NextResponse.json({ error: 'No pudimos cargar la disponibilidad. Intenta de nuevo.' }, { status: 500 })
  }
}

/** Mueve la reserva a otro día y horario. Todas las reglas se validan en el servidor. */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const customerId = await customerIdFromRequest(request)
  if (!customerId) return NextResponse.json({ error: 'Tu sesión venció. Vuelve a entrar.' }, { status: 401 })

  let date = ''
  let time = ''
  try {
    const body = await request.json()
    date = String(body?.date || '')
    time = String(body?.time || '').slice(0, 5)
  } catch {
    return NextResponse.json({ error: 'Solicitud inválida' }, { status: 400 })
  }

  const booking = await getOwnedBookingForReschedule(customerId, params.id)
  if (!booking) return NextResponse.json({ error: 'Reserva no encontrada' }, { status: 404 })

  try {
    const result = await rescheduleBooking(booking, date, time)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

    // Queda en Actividad del panel admin, a nombre del cliente, igual que una
    // reprogramación hecha por la secretaría.
    const { data: customer } = await supabaseAdmin.from('customers').select('code').eq('id', customerId).maybeSingle()
    await logAdminAction({
      actor: { username: `cliente ${customer?.code || ''}`.trim() },
      action: 'booking.rescheduled',
      entityType: 'booking',
      entityId: booking.id,
      entityLabel: [booking.client_name, result.to.date].filter(Boolean).join(' · ') || 'Reserva',
      summary:
        `El cliente reprogramó desde Mi cuenta de ${result.from.date} ${result.from.time} a ` +
        `${result.to.date} ${result.to.time}. El camión se reasigna automáticamente.`,
      changes: {
        scheduled_date: { from: result.from.date, to: result.to.date },
        scheduled_time: { from: result.from.time, to: result.to.time },
        vehicle_id: { from: 'asignado', to: null },
      },
      request,
    })

    return NextResponse.json({ ok: true, date: result.to.date, time: result.to.time })
  } catch (error) {
    console.error('[cuenta/reprogramar] Error:', error)
    return NextResponse.json({ error: 'No pudimos cambiar la fecha. Intenta de nuevo.' }, { status: 500 })
  }
}
