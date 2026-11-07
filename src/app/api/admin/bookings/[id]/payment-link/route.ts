import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { flowService } from '@/lib/flowService'
import { getActorFromRequest, logAdminAction } from '@/lib/activityLog'
import { isPaymentLedgerAvailable } from '@/lib/bookingPayments'
import { createBalanceFlowOrder } from '@/lib/balancePayment'
import {
  pendingAmount,
  servicePrice,
  actualPaidAmount,
  MIN_ABONO_CLP,
} from '@/lib/revenueBreakdown'
import { siteUrl } from '@/lib/siteUrl'

export const dynamic = 'force-dynamic'

/** Lo que necesita esta ruta de la reserva. El `select` se arma como string, así que
 *  Supabase no puede inferir el tipo: se declara acá. */
interface BookingForBalance {
  id: string
  quote_id: string | null
  client_name: string | null
  client_email: string | null
  client_phone: string | null
  status: string | null
  is_provisional: boolean | null
  payment_type: string | null
  payment_status: string | null
  total_price: number | null
  original_price: number | null
  adjusted_price: number | null
  amount_paid: number | null
}

/**
 * Genera un link de Flow por el SALDO que falta de una reserva.
 *
 * El monto NO se calcula acá: sale de `pendingAmount()`, que es la misma función que usa
 * el dashboard. Importa porque esa función sabe algo que una resta no sabe: quien pagó
 * "completo" pagó el 95% y el 5% restante es un DESCUENTO, no una deuda. Restando a mano,
 * a esos clientes se les cobraría plata que no deben.
 *
 * La orden se marca con `paymentType: 'saldo'` para que `paymentSync` la SUME a lo ya
 * cobrado en vez de ignorarla (una reserva ya aprobada no vuelve a escribir amount_paid).
 *
 * ABONO PARCIAL: el body acepta `amount` para cobrar MENOS que el saldo — el piso para
 * empezar a trabajar es MIN_ABONO_CLP, no el 50%. Se sigue mandando como 'saldo' a
 * propósito: es lo que hace que el monto se SUME a `amount_paid` sin pisar `payment_type`,
 * y así `pendingAmount()` sigue mostrando la diferencia que falta cobrar. Sin `amount`, el
 * comportamiento es el de siempre: el saldo completo.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { data: booking, error } = await supabaseAdmin
      .from('bookings')
      .select(
        'id, quote_id, client_name, client_email, client_phone, status, is_provisional, ' +
          'payment_type, payment_status, total_price, original_price, adjusted_price, amount_paid'
      )
      .eq('id', params.id)
      .maybeSingle<BookingForBalance>()

    if (error || !booking) {
      return NextResponse.json({ error: 'Reserva no encontrada' }, { status: 404 })
    }

    if (!booking.quote_id) {
      return NextResponse.json(
        { error: 'Esta reserva no tiene identificador de cotización, no se le puede cobrar por Flow' },
        { status: 400 }
      )
    }

    if (!booking.client_email) {
      return NextResponse.json(
        { error: 'La reserva no tiene email del cliente, y Flow lo necesita' },
        { status: 400 }
      )
    }

    const saldo = pendingAmount(booking)
    if (saldo <= 0) {
      // Se distingue el motivo porque son dos situaciones distintas para quien mira el panel.
      const razon =
        booking.payment_status === 'approved' && booking.payment_type === 'completo'
          ? 'Esta reserva se pagó completa (el 5% de diferencia es el descuento, no deuda)'
          : 'Esta reserva no tiene saldo pendiente'
      return NextResponse.json({ error: razon }, { status: 400 })
    }

    // Monto a cobrar: lo que pida el panel, o el saldo entero si no pide nada.
    const body = await request.json().catch(() => ({} as Record<string, unknown>))
    const pedido = body?.amount
    let monto = saldo
    let esParcial = false

    if (pedido !== undefined && pedido !== null && pedido !== '') {
      const n = Math.round(Number(pedido))
      if (!Number.isFinite(n) || n <= 0) {
        return NextResponse.json({ error: 'El monto a cobrar no es válido' }, { status: 400 })
      }
      if (n > saldo) {
        return NextResponse.json(
          {
            error: `No se puede cobrar más que el saldo pendiente ($${saldo.toLocaleString('es-CL')})`,
          },
          { status: 400 }
        )
      }
      // El piso solo aplica a un cobro PARCIAL. Si el saldo que queda es menor al mínimo,
      // cobrarlo entero tiene que seguir siendo posible: es el último cobro, no un abono.
      if (n < saldo && n < MIN_ABONO_CLP) {
        return NextResponse.json(
          {
            error: `El abono mínimo es $${MIN_ABONO_CLP.toLocaleString('es-CL')}. Para cobrar menos, cobrá el saldo completo.`,
          },
          { status: 400 }
        )
      }
      monto = n
      esParcial = n < saldo
    }

    if (!flowService.isConfigured()) {
      return NextResponse.json(
        { error: 'Flow no está configurado. Revisa las variables de entorno.' },
        { status: 500 }
      )
    }

    // Sin el libro de pagos, un saldo cobrado NO se sumaría a `amount_paid`: la plata
    // entraría a Flow y el sistema seguiría mostrando la reserva como impaga. Es mejor no
    // dejar generar el link que generar uno cuyo cobro se pierde de vista.
    if (!(await isPaymentLedgerAvailable())) {
      return NextResponse.json(
        {
          error:
            'Falta correr la migración add_booking_payments.sql. Sin ella el pago del saldo no quedaría registrado en el sistema.',
        },
        { status: 409 }
      )
    }

    const appUrl = siteUrl()

    // La orden la arma createBalanceFlowOrder, la misma que usa «Pagar saldo» del Panel del
    // Cliente: paymentSync reconoce el cobro por esos datos.
    const flowResponse = await createBalanceFlowOrder({
      quoteId: booking.quote_id,
      amount: monto,
      email: booking.client_email,
      partial: esParcial,
      appUrl,
    })

    await logAdminAction({
      actor: getActorFromRequest(request),
      action: 'booking.balance_link_created',
      entityType: 'booking',
      entityId: booking.id,
      entityLabel: [booking.client_name, booking.quote_id].filter(Boolean).join(' · '),
      summary: esParcial
        ? `Generó link de abono parcial por $${monto.toLocaleString('es-CL')} (saldo: $${saldo.toLocaleString('es-CL')})`
        : `Generó link de pago por el saldo: $${saldo.toLocaleString('es-CL')}`,
      changes: {
        saldo: {
          from: null,
          to: {
            precio: servicePrice(booking),
            pagado: actualPaidAmount(booking),
            saldo,
            cobrado: monto,
            parcial: esParcial,
          },
        },
      },
      request,
    })

    return NextResponse.json({
      success: true,
      url: flowResponse.url,
      token: flowResponse.token,
      amount: monto,
      saldo,
      partial: esParcial,
      clientName: booking.client_name,
      clientPhone: booking.client_phone,
    })
  } catch (error) {
    console.error('Error generando el link de saldo:', error)
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'No se pudo generar el link de pago',
      },
      { status: 500 }
    )
  }
}
