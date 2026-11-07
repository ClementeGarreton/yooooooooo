import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { flowService } from '@/lib/flowService'
import { isPaymentLedgerAvailable } from '@/lib/bookingPayments'
import { createBalanceFlowOrder } from '@/lib/balancePayment'
import { customerIdFromRequest } from '@/lib/customerSession'
import { canPayBalance, getOwnedBookingForPayment } from '@/lib/customerAccount'
import { actualPaidAmount, pendingAmount, servicePrice } from '@/lib/revenueBreakdown'
import { logAdminAction } from '@/lib/activityLog'
import { siteUrl } from '@/lib/siteUrl'

export const dynamic = 'force-dynamic'

/**
 * «Pagar saldo» del Panel del Cliente (Módulo 1, paso 5): orden de Flow por el SALDO
 * COMPLETO de una reserva del cliente de la sesión.
 *
 * El navegador no manda monto: sale de `pendingAmount()`, la misma función del dashboard
 * y del link de saldo del admin (sabe que el 5% del pago completo es descuento, no
 * deuda). La orden es la misma que arma el admin (`createBalanceFlowOrder`), así que
 * paymentSync la suma a lo cobrado al aprobarse y, si se rechaza o se anula, no toca la
 * reserva. El abono parcial del saldo sigue siendo solo del panel admin.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const customerId = await customerIdFromRequest(request)
  if (!customerId) return NextResponse.json({ error: 'Tu sesión venció. Vuelve a entrar.' }, { status: 401 })

  const booking = await getOwnedBookingForPayment(customerId, params.id)
  if (!booking) return NextResponse.json({ error: 'Reserva no encontrada' }, { status: 404 })

  if (!canPayBalance(booking)) {
    return NextResponse.json(
      { error: 'Esta reserva no tiene un saldo que se pueda pagar en línea. Si tienes dudas, escríbenos.' },
      { status: 409 }
    )
  }

  if (!flowService.isConfigured()) {
    return NextResponse.json(
      { error: 'El pago en línea no está disponible en este momento. Escríbenos y te ayudamos.' },
      { status: 503 }
    )
  }

  // Sin el libro de pagos, el saldo cobrado no se sumaría a `amount_paid` y la reserva
  // seguiría figurando impaga (mismo criterio que el link de saldo del admin).
  if (!(await isPaymentLedgerAvailable())) {
    console.error('[cuenta/pagar-saldo] Falta add_booking_payments.sql: no se genera el cobro.')
    return NextResponse.json(
      { error: 'El pago en línea no está disponible en este momento. Escríbenos y te ayudamos.' },
      { status: 503 }
    )
  }

  const saldo = pendingAmount(booking)

  try {
    const order = await createBalanceFlowOrder({
      quoteId: booking.quote_id,
      amount: saldo,
      email: booking.client_email,
      appUrl: siteUrl(),
    })

    const { data: customer } = await supabaseAdmin.from('customers').select('code').eq('id', customerId).maybeSingle()
    await logAdminAction({
      actor: { username: `cliente ${customer?.code || ''}`.trim() },
      action: 'booking.balance_link_created',
      entityType: 'booking',
      entityId: booking.id,
      entityLabel: [booking.client_name, booking.quote_id].filter(Boolean).join(' · '),
      summary: `El cliente abrió el pago del saldo desde Mi cuenta: $${saldo.toLocaleString('es-CL')}`,
      changes: {
        saldo: {
          from: null,
          to: {
            precio: servicePrice(booking),
            pagado: actualPaidAmount(booking),
            saldo,
            cobrado: saldo,
            parcial: false,
          },
        },
      },
      request,
    })

    return NextResponse.json({ ok: true, paymentUrl: order.url, amount: saldo })
  } catch (error) {
    console.error('[cuenta/pagar-saldo] Error creando la orden:', error)
    return NextResponse.json({ error: 'No pudimos crear el pago. Intenta de nuevo.' }, { status: 500 })
  }
}
