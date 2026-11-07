import { NextRequest, NextResponse } from 'next/server'
import { flowService } from '@/lib/flowService'
import {
  ensureProvisionalBooking,
  createQuoteFlowOrder,
  computeQuoteAmounts,
  SlotUnavailableError,
  type PaymentType,
} from '@/lib/quoteCheckout'
import { resolveBookingAttribution } from '@/lib/attributionServer'
import { CouponError, quoteCoupon, setQuoteCoupon } from '@/lib/coupons'
import { customerIdByEmail } from '@/lib/webCoupon'
import { webQuotePriceProblem } from '@/lib/server/webQuotePrice'

// Crea (o reutiliza) la pre-reserva y genera la orden Flow para pagar EN LA PÁGINA.
// Comparte la misma lógica que /api/prospects/send-quote => un solo booking por cotización.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      quoteId,
      paymentType,
      client,
      schedule,
      addresses,
      propertyDetails,
      estimatedPrice: listPrice,
      photoUrls,
      stops,
    } = body as {
      quoteId: string
      paymentType: PaymentType
      client: any
      schedule: any
      addresses: any
      propertyDetails?: any
      estimatedPrice: number
      photoUrls?: string[]
      stops?: unknown
    }

    if (!quoteId || !paymentType || !client?.email || !listPrice) {
      return NextResponse.json({ error: 'Datos incompletos' }, { status: 400 })
    }

    if (!flowService.isConfigured()) {
      return NextResponse.json(
        { error: 'Flow no está configurado. Por favor contacta al administrador.' },
        { status: 500 }
      )
    }

    // El precio de lista llega del navegador: se compara con lo que da la fórmula sobre lo
    // que el cliente declaró, antes de que cuente para el cupón o la pre-reserva.
    const problemaPrecio = await webQuotePriceProblem('quote/checkout', quoteId, listPrice, body?.pricingInput)
    if (problemaPrecio) return NextResponse.json({ error: problemaPrecio }, { status: 409 })

    // Cupón o código de referido (opcional, campaña OCTUBRE): se valida de nuevo acá. El
    // descuento se aplica ANTES del abono del 50% o del pago completo con 5%: la pre-reserva
    // nace con el precio ya rebajado, igual que al reservar desde «Mi cuenta».
    const couponCode = typeof body?.couponCode === 'string' ? body.couponCode.trim() : ''
    let coupon: Awaited<ReturnType<typeof quoteCoupon>> | null = null
    if (couponCode) {
      try {
        coupon = await quoteCoupon(couponCode, await customerIdByEmail(client.email), quoteId, listPrice)
      } catch (error) {
        if (error instanceof CouponError) return NextResponse.json({ error: error.message }, { status: error.status })
        throw error
      }
    }
    const estimatedPrice = coupon ? coupon.finalPrice : listPrice

    const attribution = await resolveBookingAttribution(body, quoteId)

    const { locked, bookingRowId } = await ensureProvisionalBooking({
      quoteId,
      client,
      schedule,
      addresses,
      propertyDetails,
      estimatedPrice,
      paymentType,
      photoUrls,
      stops,
      attribution,
      // Casilla «Estoy de acuerdo con las Políticas de Garantía» del resumen.
      policiesAccepted: body?.policiesAccepted === true,
    })

    // Si ya está pagada, no generamos otra orden de Flow: evita que el cliente pague dos
    // veces (ej. reintenta el checkout con el mismo quote_id tras ya haber pagado).
    if (locked) {
      return NextResponse.json(
        { error: 'Esta reserva ya fue pagada. Si crees que es un error, contáctanos.' },
        { status: 409 }
      )
    }

    // El uso del cupón (o su retiro, si esta vez se paga sin cupón) queda registrado con la
    // ficha del cliente, que la base crea sola con la pre-reserva.
    const customerId = await customerIdByEmail(client.email)
    if (customerId) await setQuoteCoupon(customerId, quoteId, listPrice, coupon, bookingRowId)
    else if (coupon) console.warn('[quote/checkout] Cupón sin ficha de cliente para registrarlo:', quoteId)

    const amounts = computeQuoteAmounts(estimatedPrice)
    const amount = paymentType === 'completo' ? amounts.full95 : amounts.abono50
    const subject = `Servicio de Mudanza - ${
      paymentType === 'completo' ? 'Pago Completo' : 'Abono 50%'
    }`

    const order = await createQuoteFlowOrder({
      quoteId,
      paymentType,
      amount,
      email: client.email,
      subject,
    })

    return NextResponse.json({ success: true, paymentUrl: order.url, amount, finalPrice: estimatedPrice })
  } catch (error) {
    if (error instanceof SlotUnavailableError) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    console.error('[quote/checkout] Error:', error)
    return NextResponse.json(
      {
        error: 'Error al crear la orden de pago',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
