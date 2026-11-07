import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getActorFromRequest, logAdminAction } from '@/lib/activityLog'
import { pickAttribution, hasAttribution, backfillAttribution } from '@/lib/attributionServer'
import { normalizeStops } from '@/lib/stops'
import { sendBookingConfirmedIfEligible } from '@/lib/transactionalEmails'
import { FULL_RATIO } from '@/lib/revenueBreakdown'
import { isPaymentLedgerAvailable, recordPayment } from '@/lib/bookingPayments'
import { markBookingManual } from '@/lib/bookingOriginServer'
import { quoteStatePhotos } from '@/lib/quoteState'

// Crea (o confirma) una RESERVA real a partir de un prospecto, sin pasar por pago online.
// Útil cuando el admin cierra el trato por WhatsApp/teléfono. La reserva queda confirmada
// y NO provisional (consume cupo). El prospecto pasa a 'converted'.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { prospectId } = body as { prospectId?: string }
    const priceInput = body.price
    const commentInput = typeof body.comment === 'string' ? body.comment : undefined
    const dateInput = typeof body.date === 'string' && body.date ? body.date : undefined
    const timeInput = typeof body.time === 'string' && body.time ? body.time : undefined
    // Cierre manual (WhatsApp/teléfono) con pago ya recibido fuera de Flow.
    const alreadyPaid = body.paid === true
    const paymentMethod =
      typeof body.paymentMethod === 'string' && body.paymentMethod ? body.paymentMethod : 'manual'
    // Cuánto entregó el cliente. No se deduce dinero desde "mitad" o "completo":
    // para declarar un pago hace falta el importe observado.
    const amountPaidInput = body.amountPaid
    const parsedAmountPaid =
      amountPaidInput === undefined || amountPaidInput === null || amountPaidInput === ''
        ? null
        : Math.max(0, Math.round(Number(amountPaidInput) || 0))

    if (!prospectId) {
      return NextResponse.json({ error: 'prospectId requerido' }, { status: 400 })
    }

    const { data: prospect, error: findError } = await supabaseAdmin
      .from('quote_prospects')
      .select('*')
      .eq('id', prospectId)
      .maybeSingle()

    if (findError || !prospect) {
      return NextResponse.json({ error: 'Prospecto no encontrado' }, { status: 404 })
    }
    if (!prospect.name || !prospect.email || !prospect.phone) {
      return NextResponse.json(
        { error: 'El prospecto no tiene nombre, email o teléfono completos' },
        { status: 400 }
      )
    }

    const effDate = dateInput || prospect.scheduled_date
    const effTime = timeInput || prospect.scheduled_time
    if (!effDate || !effTime) {
      return NextResponse.json(
        { error: 'Falta fecha u hora. Agrégalas en el modal antes de crear la reserva.' },
        { status: 400 }
      )
    }

    const parsedPrice =
      priceInput === undefined || priceInput === null || priceInput === ''
        ? null
        : Math.round(Number(priceInput))
    const effectivePrice = parsedPrice ?? prospect.adjusted_price ?? prospect.total_price
    if (!effectivePrice || effectivePrice <= 0) {
      return NextResponse.json({ error: 'Precio inválido' }, { status: 400 })
    }

    // Monto realmente entregado y modalidad que se deriva de él: pagar el total (o más)
    // es «completo»; cualquier abono parcial queda como «mitad», que es como el resto del
    // panel lee «pagó algo y falta el saldo» (filtro «Por cobrar», link de saldo, correo).
    const paidAmount = parsedAmountPaid ?? 0
    // Umbral del pago completo: el 95% del precio, porque pagar todo por adelantado lleva
    // 5% de descuento. Quien transfiere ese monto pagó completo y no debe nada; cualquier
    // cosa por debajo es un abono y deja saldo.
    const paymentType =
      paidAmount >= Math.round(Number(effectivePrice) * FULL_RATIO) ? 'completo' : 'mitad'
    if (alreadyPaid && (paidAmount <= 0 || paidAmount > Number(effectivePrice))) {
      return NextResponse.json(
        { error: 'Indica el monto realmente recibido, mayor que cero y no superior al precio del servicio.' },
        { status: 400 }
      )
    }
    if (alreadyPaid && !(await isPaymentLedgerAvailable())) {
      return NextResponse.json({ error: 'El libro de pagos no está disponible; no se creó una reserva con cobro.' }, { status: 503 })
    }

    const comment = commentInput !== undefined ? commentInput : prospect.adjustment_comment || ''
    const quoteId = prospect.quote_id || `Q-PROS-${prospect.id}`

    // ¿Ya existe un booking para este quote_id? (p.ej. una pre-reserva provisional previa)
    const { data: existing } = await supabaseAdmin
      .from('bookings')
      .select('id, amount_paid, gclid, gbraid, wbraid, utm_source, utm_campaign')
      .eq('quote_id', quoteId)
      .maybeSingle()
    if (alreadyPaid && Number(existing?.amount_paid || 0) > 0) {
      return NextResponse.json({ error: 'La reserva ya tiene un cobro registrado. Para sumar otro pago, usa «Registrar pago» en Reservas.' }, { status: 409 })
    }

    // Reserva creada desde una cotizacion previa: hereda la atribucion del prospecto.
    const prospectAttribution = pickAttribution(prospect)

    let bookingId: string

    if (existing) {
      // Upgrade: la pre-reserva pasa a reserva real confirmada
      const { data: updated, error: updErr } = await supabaseAdmin
        .from('bookings')
        .update({
          status: 'confirmed',
          is_provisional: false,
          scheduled_date: effDate,
          scheduled_time: effTime,
          total_price: effectivePrice,
          adjusted_price:
            prospect.total_price && Number(prospect.total_price) !== Number(effectivePrice)
              ? effectivePrice
              : null,
          notes: comment || null,
          origin_floor: prospect.origin_floor ?? null,
          origin_has_elevator: prospect.origin_has_elevator ?? null,
          destination_floor: prospect.destination_floor ?? null,
          destination_has_elevator: prospect.destination_has_elevator ?? null,
          // La pre-reserva pudo nacer sin paradas (el pago web no las mandaba): se completan
          // con las del lead. Si el lead no tiene, no se borran las que ya tenga la reserva.
          ...(normalizeStops(prospect.stops).length ? { stops: normalizeStops(prospect.stops) } : {}),
          ...(alreadyPaid
            ? {
                payment_status: 'approved',
                payment_method: paymentMethod,
                payment_type: paymentType,
                payment_date: new Date().toISOString(),
                amount_paid: paidAmount,
              }
            : {}),
        })
        .eq('id', existing.id)
        .select('id')
        .single()

      if (updErr || !updated) {
        console.error('[admin/create-booking] Error actualizando booking:', updErr)
        return NextResponse.json({ error: 'Error al confirmar la reserva' }, { status: 500 })
      }
      bookingId = updated.id
      // Rellenar la atribucion solo donde falte (nunca sobrescribe un gclid ya guardado).
      await backfillAttribution('bookings', existing.id, prospectAttribution, existing)
    } else {
      // Verificar cupo real (solo reservas no provisionales cuentan)
      const { data: configData, error: configError } = await supabaseAdmin
        .from('fleet_config')
        .select('num_vehicles')
        .single()
      if (configError || !configData) {
        return NextResponse.json({ error: 'Error obteniendo configuración de flota' }, { status: 500 })
      }

      const { count: bookingCount } = await supabaseAdmin
        .from('bookings')
        .select('id', { count: 'exact', head: true })
        .eq('scheduled_date', effDate)
        .eq('scheduled_time', effTime)
        .eq('is_provisional', false)
        .in('status', ['confirmed', 'pending'])

      const { data: blockedData } = await supabaseAdmin
        .from('blocked_slots')
        .select('id')
        .eq('date', effDate)
        .lte('start_time', effTime)
        .gt('end_time', effTime)

      const availableSlots = configData.num_vehicles - (bookingCount || 0)
      const isBlocked = Boolean(blockedData && blockedData.length > 0)
      if (availableSlots <= 0 || isBlocked) {
        return NextResponse.json({ error: 'Este horario ya no está disponible' }, { status: 409 })
      }

      const isCompany = prospect.is_company || false
      const { data: created, error: createError } = await supabaseAdmin
        .from('bookings')
        .insert({
          quote_id: quoteId,
          client_name: prospect.name,
          client_email: prospect.email,
          client_phone: prospect.phone,
          scheduled_date: effDate,
          scheduled_time: effTime,
          duration_hours: 4,
          status: 'confirmed',
          payment_status: alreadyPaid ? 'approved' : 'pending',
          payment_method: alreadyPaid ? paymentMethod : null,
          payment_type: alreadyPaid ? paymentType : null,
          payment_date: alreadyPaid ? new Date().toISOString() : null,
          is_provisional: false,
          total_price: effectivePrice,
          original_price: prospect.total_price ?? effectivePrice,
          adjusted_price:
            prospect.total_price && Number(prospect.total_price) !== Number(effectivePrice)
              ? effectivePrice
              : null,
          amount_paid: alreadyPaid ? paidAmount : 0,
          origin_address: prospect.origin_address || null,
          destination_address: prospect.destination_address || null,
          // La ruta viaja con la reserva: si el cliente cotizó con paradas, el chofer
          // tiene que verlas en la orden de trabajo, no solo las dos puntas.
          stops: normalizeStops(prospect.stops).length ? normalizeStops(prospect.stops) : null,
          origin_floor: prospect.origin_floor ?? null,
          origin_has_elevator: prospect.origin_has_elevator ?? null,
          destination_floor: prospect.destination_floor ?? null,
          destination_has_elevator: prospect.destination_has_elevator ?? null,
          is_company: isCompany,
          company_name: isCompany ? prospect.company_name || null : null,
          company_rut: isCompany ? prospect.company_rut || null : null,
          // Las fotos que subió el cliente al cotizar viajan con la reserva.
          photo_urls: quoteStatePhotos(prospect.quote_state),
          notes: comment || null,
          ...(hasAttribution(prospectAttribution) ? prospectAttribution : {}),
        })
        .select('id')
        .single()

      if (createError || !created) {
        console.error('[admin/create-booking] Error creando booking:', createError)
        return NextResponse.json({ error: 'Error al crear la reserva' }, { status: 500 })
      }
      bookingId = created.id
    }
    await markBookingManual(bookingId)

    const ledger = alreadyPaid
      ? await recordPayment({ bookingId, quoteId, flowToken: null, amount: paidAmount, kind: 'manual' })
      : null
    if (ledger && !ledger.recorded) {
      console.error('[admin/create-booking] Reserva con cobro sin movimiento en booking_payments:', bookingId)
    }

    // Marcar prospecto como convertido + persistir ajuste/agenda/quote_id
    await supabaseAdmin
      .from('quote_prospects')
      .update({
        status: 'converted',
        converted_booking_id: bookingId,
        adjusted_price: parsedPrice ?? prospect.adjusted_price ?? null,
        adjustment_comment: comment || null,
        scheduled_date: effDate,
        scheduled_time: effTime,
        quote_id: quoteId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', prospect.id)

    await logAdminAction({
      actor: getActorFromRequest(request),
      action: 'prospect.converted_to_booking',
      entityType: 'booking',
      entityId: bookingId,
      entityLabel: [prospect.name, effDate].filter(Boolean).join(' · '),
      summary: `Convirtió el lead ${prospect.name || prospect.email || ''} en reserva para ${effDate} ${String(effTime || '').slice(0, 5)} por $${Number(effectivePrice).toLocaleString('es-CL')}${
        alreadyPaid
          ? ` · pagó $${paidAmount.toLocaleString('es-CL')} (${paymentMethod}), saldo $${Math.max(
              0,
              Number(effectivePrice) - paidAmount
            ).toLocaleString('es-CL')}`
          : ''
      }`,
      changes: {
        converted: {
          from: { prospect_id: prospect.id },
          to: {
            booking_id: bookingId,
            quote_id: quoteId,
            price: effectivePrice,
            ...(alreadyPaid
              ? { amount_paid: paidAmount, payment_type: paymentType, payment_method: paymentMethod }
              : {}),
          },
        },
      },
      request,
    })

    // Correo de ingreso (#05). Antes solo llegaba si se marcaba «ya pagó», y recién con
    // el cron de la hora siguiente; una reserva cerrada por WhatsApp sin pago no lo recibía.
    // Idempotente: si esta reserva ya lo tenía (p.ej. una pre-reserva pagada), no se repite.
    await sendBookingConfirmedIfEligible(bookingId)

    return NextResponse.json({ success: true, bookingId, quoteId, price: effectivePrice, paymentLedgerRecorded: ledger?.recorded ?? null })
  } catch (error) {
    console.error('[admin/create-booking] Error:', error)
    return NextResponse.json(
      { error: 'Error al crear la reserva', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
