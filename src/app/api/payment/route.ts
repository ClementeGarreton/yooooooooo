import { NextRequest, NextResponse } from 'next/server'
import { flowService } from '@/lib/flowService'
import { supabaseAdmin } from '@/lib/supabase'
import { MIN_ABONO_CLP, servicePrice } from '@/lib/revenueBreakdown'
import { normalizeHomeVisitPrice } from '@/lib/homeVisitPricing'
import { readPricingConfig } from '@/lib/server/pricingConfigServer'
import { siteUrl } from '@/lib/siteUrl'

// Este endpoint crea una orden de pago en Flow.
//
// El monto llega del navegador, así que acá se comprueba contra la reserva: sin esto,
// cualquiera podía pedir una orden de $1.000 para una mudanza de $300.000 y pagarla.
// No se exige un monto exacto porque hay varias formas legítimas de pagar (abono del
// 50%, total con 5% de descuento, total sin descuento, abonos que arma el panel): se
// exige que esté entre el piso del abono y el precio del servicio. La visita a domicilio
// sí tiene precio único, y ese sale de la configuración, no del navegador.
async function montoInvalido(
  bookingId: string,
  amount: number,
  paymentType?: string
): Promise<string | null> {
  const { data: booking, error } = await supabaseAdmin
    .from('bookings')
    .select('quote_id, booking_type, total_price, original_price, adjusted_price')
    .eq('quote_id', bookingId)
    .maybeSingle()

  // Sin reserva no hay contra qué comparar, y no se crea la orden: sus dos llamadores crean la
  // reserva antes de cobrar. Dejarlo pasar permitía fabricar cobros con cualquier monto.
  if (error) {
    console.error(`[payment] No se pudo leer la reserva ${bookingId}:`, error)
    return 'No pudimos verificar la reserva. Intenta nuevamente.'
  }
  if (!booking) return 'No encontramos esa reserva'

  const esDomicilio =
    booking.booking_type === 'domicilio' || String(booking.quote_id || '').startsWith('DOMICILIO-')
  if (esDomicilio) {
    const config = await readPricingConfig()
    const esperado = normalizeHomeVisitPrice(config.additionalServices?.homeVisitPrice)
    return amount === esperado ? null : `El precio de la visita a domicilio es $${esperado.toLocaleString('es-CL')}`
  }

  const precio = servicePrice(booking)
  if (precio > 0 && amount > precio) return 'El monto supera el precio del servicio'
  // El piso es el abono mínimo, salvo que el servicio valga menos: un flete de $20.000 se
  // paga entero y no puede quedar bloqueado por un piso pensado para mudanzas.
  const piso = precio > 0 ? Math.min(MIN_ABONO_CLP, precio) : MIN_ABONO_CLP
  if (amount < piso) {
    return `El monto mínimo para esta reserva es $${piso.toLocaleString('es-CL')}`
  }
  return null
}

export async function POST(request: NextRequest) {
  try {
    const { bookingId, amount, email, paymentType } = await request.json()

    if (!bookingId || !amount || !email) {
      return NextResponse.json(
        { error: 'Datos incompletos' },
        { status: 400 }
      )
    }

    const montoPedido = Math.round(Number(amount))
    if (!Number.isFinite(montoPedido) || montoPedido <= 0) {
      return NextResponse.json({ error: 'Monto inválido' }, { status: 400 })
    }

    const problema = await montoInvalido(String(bookingId), montoPedido, paymentType)
    if (problema) {
      console.warn(`[payment] Monto rechazado para ${bookingId}: $${montoPedido} — ${problema}`)
      return NextResponse.json({ error: problema }, { status: 400 })
    }

    // Verificar que Flow está configurado
    if (!flowService.isConfigured()) {
      return NextResponse.json(
        { error: 'Flow no está configurado. Por favor contacta al administrador.' },
        { status: 500 }
      )
    }

    // Obtener URL base de la aplicación
    const appUrl = siteUrl()

    // Crear orden de pago en Flow
    const paymentData = {
      commerceOrder: bookingId, // ID único de la reserva
      // Fijo: el asunto lo ve el cliente en Flow y no puede venir de quien llama.
      subject: String(bookingId).startsWith('DOMICILIO-') ? 'Cotización a Domicilio - Yo Me Encargo' : 'Servicio de Mudanza - Yo Me Encargo',
      currency: 'CLP',
      amount: montoPedido,
      email: email,
      urlConfirmation: `${appUrl}/api/payment/confirm`, // Flow enviará notificación aquí
      urlReturn: `${appUrl}/api/payment/result`, // Usuario será redirigido aquí
      optional: JSON.stringify({ bookingId, paymentType }), // Datos adicionales mínimos
    }

    const flowResponse = await flowService.createPayment(paymentData)

    return NextResponse.json({
      success: true,
      paymentUrl: flowResponse.url,
      token: flowResponse.token,
      flowOrder: flowResponse.flowOrder,
    })
  } catch (error) {
    console.error('Error processing payment:', error)
    return NextResponse.json(
      { error: 'Error al procesar el pago' },
      { status: 500 }
    )
  }
}
