/**
 * Orden de Flow por el SALDO de una reserva. La usan el link de saldo del panel admin y el
 * botón «Pagar saldo» del Panel del Cliente: tienen que armar EXACTAMENTE la misma orden,
 * porque `paymentSync` reconoce el cobro por estos datos.
 *
 *  - `optional.bookingId` es el quote_id estable: el webhook resuelve siempre la misma
 *    reserva, aunque de ella salgan varios intentos de cobro.
 *  - `optional.paymentType: 'saldo'` es lo que le dice a paymentSync que SUME el monto a
 *    lo ya cobrado (y que una orden de saldo no aprobada no toque la reserva).
 *  - `commerceOrder` es único por intento: Flow rechaza dos órdenes con el mismo id.
 */

import { flowService } from '@/lib/flowService'

export async function createBalanceFlowOrder(params: {
  quoteId: string
  amount: number
  email: string
  /** true = abono parcial del saldo (solo lo arma el admin). Cambia el asunto. */
  partial?: boolean
  appUrl: string
}) {
  const { quoteId, amount, email, partial = false, appUrl } = params
  return flowService.createPayment({
    commerceOrder: `${quoteId}-saldo-${Date.now()}`,
    subject: `${partial ? 'Abono' : 'Saldo'} mudanza ${quoteId} - Yo Me Encargo`,
    currency: 'CLP',
    amount,
    email,
    urlConfirmation: `${appUrl}/api/payment/confirm`,
    urlReturn: `${appUrl}/api/payment/result`,
    optional: JSON.stringify({ bookingId: quoteId, paymentType: 'saldo' }),
  })
}
