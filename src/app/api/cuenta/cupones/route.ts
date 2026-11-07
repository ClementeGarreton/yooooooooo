import { NextRequest, NextResponse } from 'next/server'
import { customerIdFromRequest } from '@/lib/customerSession'
import { canReserveQuote, getOwnedQuote } from '@/lib/customerAccount'
import { quoteValue } from '@/lib/revenueBreakdown'
import { CouponError, quoteCoupon } from '@/lib/coupons'

export const dynamic = 'force-dynamic'

/**
 * Consulta cuánto descuenta un cupón en una cotización del cliente de la sesión. Body:
 * `{ quoteId, code }`. No escribe nada: el cupón se registra recién al reservar, donde se
 * vuelve a validar. El precio sale de la cotización guardada, no del navegador.
 */
export async function POST(request: NextRequest) {
  const customerId = await customerIdFromRequest(request)
  if (!customerId) return NextResponse.json({ error: 'Tu sesión venció. Vuelve a entrar.' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const quote = await getOwnedQuote(customerId, String(body?.quoteId || ''))
  if (!quote || !quote.quote_id || !canReserveQuote(quote)) {
    return NextResponse.json({ error: 'Esta cotización ya no se puede reservar desde aquí.' }, { status: 409 })
  }

  try {
    const { couponId: _couponId, ...result } = await quoteCoupon(body?.code, customerId, quote.quote_id, quoteValue(quote))
    return NextResponse.json({ ok: true, coupon: result })
  } catch (error) {
    if (error instanceof CouponError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('[cuenta/cupones] Error:', error)
    return NextResponse.json({ error: 'No pudimos revisar el cupón. Intenta de nuevo.' }, { status: 500 })
  }
}
