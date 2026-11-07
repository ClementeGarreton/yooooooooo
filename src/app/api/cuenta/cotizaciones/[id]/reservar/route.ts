import { NextRequest, NextResponse } from 'next/server'
import { flowService } from '@/lib/flowService'
import {
  computeQuoteAmounts,
  createQuoteFlowOrder,
  ensureProvisionalBooking,
  SlotUnavailableError,
  type PaymentType,
} from '@/lib/quoteCheckout'
import { resolveBookingAttribution } from '@/lib/attributionServer'
import { customerIdFromRequest } from '@/lib/customerSession'
import { canReserveQuote, getOwnedQuote } from '@/lib/customerAccount'
import { quoteValue } from '@/lib/revenueBreakdown'
import { CouponError, quoteCoupon, setQuoteCoupon } from '@/lib/coupons'

export const dynamic = 'force-dynamic'

/**
 * Reserva y paga una cotización vigente desde el Panel del Cliente («Retomar»).
 *
 * A diferencia de /api/quote/checkout, acá el navegador NO manda ni el precio ni los
 * datos de la mudanza: todo sale de la cotización guardada, leída en el servidor y
 * filtrada por el cliente de la sesión. El cliente solo elige cómo paga. El precio es el
 * cotizado (o el ajustado por el panel, si lo hay): una cotización vigente se respeta.
 *
 * Usa la misma pre-reserva y la misma orden de Flow que el cotizador web, enganchadas por
 * `quote_id`, así que el webhook de pago y el panel admin no notan la diferencia.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const customerId = await customerIdFromRequest(request)
  if (!customerId) {
    return NextResponse.json({ error: 'Tu sesión venció. Vuelve a entrar.' }, { status: 401 })
  }

  let paymentType: PaymentType
  let policiesAccepted = false
  let couponCode = ''
  try {
    const body = await request.json()
    paymentType = body?.paymentType
    policiesAccepted = body?.policiesAccepted === true
    couponCode = typeof body?.couponCode === 'string' ? body.couponCode.trim() : ''
  } catch {
    return NextResponse.json({ error: 'Solicitud inválida' }, { status: 400 })
  }

  if (paymentType !== 'mitad' && paymentType !== 'completo') {
    return NextResponse.json({ error: 'Elige cómo quieres pagar' }, { status: 400 })
  }
  if (!policiesAccepted) {
    return NextResponse.json(
      { error: 'Para reservar debes aceptar nuestras Políticas de Garantía.' },
      { status: 400 }
    )
  }

  const quote = await getOwnedQuote(customerId, params.id)
  if (!quote || !quote.quote_id || !canReserveQuote(quote)) {
    return NextResponse.json(
      { error: 'Esta cotización ya no se puede reservar desde aquí. Escríbenos y te ayudamos.' },
      { status: 409 }
    )
  }

  if (!flowService.isConfigured()) {
    return NextResponse.json(
      { error: 'El pago en línea no está disponible en este momento. Escríbenos y te ayudamos.' },
      { status: 503 }
    )
  }

  // Cupón (opcional): se valida de nuevo acá, contra el precio de la cotización guardada.
  // El descuento se aplica ANTES del abono del 50% o del pago completo con 5%: la
  // pre-reserva nace con el precio ya rebajado.
  const listPrice = quoteValue(quote)
  let coupon: Awaited<ReturnType<typeof quoteCoupon>> | null = null
  if (couponCode) {
    try {
      coupon = await quoteCoupon(couponCode, customerId, quote.quote_id, listPrice)
    } catch (error) {
      if (error instanceof CouponError) return NextResponse.json({ error: error.message }, { status: error.status })
      throw error
    }
  }
  const estimatedPrice = coupon ? coupon.finalPrice : listPrice

  try {
    const { locked, bookingRowId } = await ensureProvisionalBooking({
      quoteId: quote.quote_id,
      client: {
        name: quote.name || undefined,
        email: quote.email || undefined,
        phone: quote.phone || undefined,
        isCompany: Boolean(quote.is_company),
        companyName: quote.company_name,
        companyRut: quote.company_rut,
      },
      schedule: {
        date: quote.scheduled_date,
        // TIME de Postgres viene como HH:MM:SS; el cotizador web guarda HH:MM.
        time: quote.scheduled_time ? quote.scheduled_time.slice(0, 5) : null,
      },
      addresses: {
        origin: quote.origin_address || undefined,
        destination: quote.destination_address || undefined,
      },
      propertyDetails: {
        origin: {
          floor: quote.origin_floor,
          hasElevator: quote.origin_has_elevator,
          parkingDistance: quote.origin_parking_distance,
        },
        destination: {
          floor: quote.destination_floor,
          hasElevator: quote.destination_has_elevator,
          parkingDistance: quote.destination_parking_distance,
        },
      },
      estimatedPrice,
      paymentType,
      stops: quote.stops,
      // Sin atribución del navegador: se hereda la de la cotización original, que es el
      // clic que de verdad trajo a este cliente.
      attribution: await resolveBookingAttribution({}, quote.quote_id),
      policiesAccepted: true,
    })

    if (locked) {
      return NextResponse.json(
        { error: 'Esta reserva ya fue pagada. Si crees que es un error, escríbenos.' },
        { status: 409 }
      )
    }

    // La pre-reserva ya quedó al precio que corresponde; ahora el registro del cupón
    // (o su retiro, si esta vez se reservó sin cupón) para que calce con ese precio.
    await setQuoteCoupon(customerId, quote.quote_id, listPrice, coupon, bookingRowId)

    const amounts = computeQuoteAmounts(estimatedPrice)
    const amount = paymentType === 'completo' ? amounts.full95 : amounts.abono50
    const order = await createQuoteFlowOrder({
      quoteId: quote.quote_id,
      paymentType,
      amount,
      email: String(quote.email || ''),
      subject: `Servicio de Mudanza - ${paymentType === 'completo' ? 'Pago Completo' : 'Abono 50%'}`,
    })

    return NextResponse.json({ ok: true, paymentUrl: order.url, amount })
  } catch (error) {
    if (error instanceof SlotUnavailableError) {
      return NextResponse.json(
        { error: 'Ese horario ya se ocupó. Escríbenos y buscamos otra fecha.' },
        { status: 409 }
      )
    }
    console.error('[cuenta/reservar] Error:', error)
    return NextResponse.json({ error: 'No pudimos crear el pago. Intenta de nuevo.' }, { status: 500 })
  }
}
