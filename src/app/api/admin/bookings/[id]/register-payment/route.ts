import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getActorFromRequest, logAdminAction } from '@/lib/activityLog'
import { recordPayment } from '@/lib/bookingPayments'
import { actualPaidAmount, pendingAmount, servicePrice } from '@/lib/revenueBreakdown'
import { sendBookingConfirmedIfEligible } from '@/lib/transactionalEmails'

export const dynamic = 'force-dynamic'

const MEDIOS: Record<string, string> = {
  transferencia: 'transferencia',
  efectivo: 'efectivo',
  otro: 'otro medio',
}

/**
 * Registrar un pago recibido fuera de Flow (transferencia, efectivo) sobre el saldo de
 * una reserva: SUMA el monto a lo ya pagado.
 *
 * Existe porque el perfil Secretaría no tenía cómo anotar que el cliente pagó el saldo
 * («no me deja ponerle pagado», 28-sep-2026): el único camino era corregir «Monto pagado
 * real» en Editar, que es solo del Administrador porque ahí también se reajusta el
 * precio. Registrar un pago no cambia el precio, así que lo pueden hacer los dos perfiles.
 *
 * Reglas:
 *  - Solo sobre el saldo: el monto no puede superar lo que falta cobrar. Si el cliente
 *    pagó de más o hay que corregir el precio, eso es un reajuste (Editar, Administrador).
 *  - Se SUMA, no se reemplaza: así dos pagos parciales no se pisan.
 *  - La escritura exige que lo pagado siga siendo lo que se leyó: si alguien registró
 *    otro pago entre medio, se rechaza en vez de sumar sobre un número viejo.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await request.json().catch(() => ({} as Record<string, unknown>))
    const monto = Math.round(Number(body?.amount))
    const medio = typeof body?.method === 'string' && MEDIOS[body.method] ? body.method : null
    const nota = typeof body?.note === 'string' ? body.note.trim().slice(0, 300) : ''

    if (!Number.isFinite(monto) || monto <= 0) {
      return NextResponse.json({ error: 'Ingresa un monto mayor que cero' }, { status: 400 })
    }
    if (!medio) {
      return NextResponse.json({ error: 'Elige el medio de pago' }, { status: 400 })
    }

    const { data: booking, error } = await supabaseAdmin
      .from('bookings')
      .select(
        'id, quote_id, client_name, scheduled_date, status, is_provisional, payment_type, payment_status, ' +
          'payment_method, payment_date, total_price, original_price, adjusted_price, amount_paid'
      )
      .eq('id', params.id)
      .maybeSingle<any>()

    if (error || !booking) {
      return NextResponse.json({ error: 'Reserva no encontrada' }, { status: 404 })
    }

    const saldo = pendingAmount(booking)
    if (saldo <= 0) {
      return NextResponse.json({ error: 'Esta reserva no tiene saldo pendiente' }, { status: 400 })
    }
    if (monto > saldo) {
      return NextResponse.json(
        {
          error: `El monto supera lo que falta cobrar ($${saldo.toLocaleString('es-CL')}). Si el precio cambió, hay que reajustarlo en «Editar».`,
        },
        { status: 400 }
      )
    }

    const pagadoAntes = actualPaidAmount(booking)
    const pagadoAhora = pagadoAntes + monto
    const ahora = new Date().toISOString()

    const update: Record<string, unknown> = {
      amount_paid: pagadoAhora,
      payment_status: 'approved',
      payment_date: booking.payment_date || ahora,
    }
    // El medio de la reserva se completa solo si no tenía: si nació con link de pago, se
    // conserva (el detalle de cada cobro queda en el libro de pagos y en Actividad).
    if (!booking.payment_method) update.payment_method = medio === 'efectivo' ? 'cash' : 'transfer'

    // Candado: solo se escribe si lo pagado sigue siendo lo que se leyó.
    let query = supabaseAdmin.from('bookings').update(update).eq('id', booking.id)
    query =
      booking.amount_paid === null || booking.amount_paid === undefined
        ? query.is('amount_paid', null)
        : query.eq('amount_paid', booking.amount_paid)
    const { data: actualizadas, error: updateError } = await query.select('id')

    if (updateError) {
      console.error('[register-payment] Error actualizando la reserva:', updateError)
      return NextResponse.json({ error: 'No se pudo registrar el pago' }, { status: 500 })
    }
    if (!actualizadas || actualizadas.length === 0) {
      return NextResponse.json(
        { error: 'Alguien registró otro pago en esta reserva recién. Actualiza la lista y vuelve a intentar.' },
        { status: 409 }
      )
    }

    // Libro de pagos: una fila por cobro. Si falla no se deshace el pago (la reserva es
    // la fuente de verdad de lo cobrado); solo queda anotado.
    if (booking.quote_id) {
      await recordPayment({
        bookingId: booking.id,
        quoteId: booking.quote_id,
        flowToken: null,
        amount: monto,
        kind: 'manual',
        status: 'approved',
        paidAt: ahora,
      })
    }

    const precio = servicePrice(booking)
    const saldoNuevo = pendingAmount({ ...booking, ...update })
    await logAdminAction({
      actor: getActorFromRequest(request),
      action: 'booking.payment_registered',
      entityType: 'booking',
      entityId: booking.id,
      entityLabel: [booking.client_name, booking.scheduled_date].filter(Boolean).join(' · '),
      summary:
        `Registró un pago de $${monto.toLocaleString('es-CL')} (${MEDIOS[medio]}). ` +
        `Pagado $${pagadoAhora.toLocaleString('es-CL')} de $${precio.toLocaleString('es-CL')}` +
        (saldoNuevo > 0 ? `; falta $${saldoNuevo.toLocaleString('es-CL')}` : '; sin saldo pendiente') +
        (nota ? ` — ${nota}` : ''),
      changes: {
        amount_paid: { from: pagadoAntes, to: pagadoAhora },
        ...(booking.payment_status !== 'approved'
          ? { payment_status: { from: booking.payment_status, to: 'approved' } }
          : {}),
      },
    })

    // Igual que al aprobar un pago desde Editar: si la reserva recién queda pagada, le
    // corresponde el correo de ingreso. Idempotente y con sus propias guardas.
    if (booking.payment_status !== 'approved') {
      await sendBookingConfirmedIfEligible(booking.id)
    }

    return NextResponse.json({
      success: true,
      amount_paid: pagadoAhora,
      payment_status: 'approved',
      pending: saldoNuevo,
    })
  } catch (error) {
    console.error('[register-payment] Error:', error)
    return NextResponse.json({ error: 'No se pudo registrar el pago' }, { status: 500 })
  }
}
