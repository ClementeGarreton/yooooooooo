import { NextRequest, NextResponse } from 'next/server'
import { CouponError, quoteCoupon } from '@/lib/coupons'
import { customerIdByEmail } from '@/lib/webCoupon'
import { isValidEmail } from '@/lib/emailFormat'

export const dynamic = 'force-dynamic'

/**
 * Cotizador web: cuánto descuenta un cupón o código de referido. Body: `{ code, quoteId,
 * email, price }`. No escribe nada: el cupón se registra al pagar, en /api/quote/checkout,
 * donde se vuelve a validar. El cliente se reconoce por su correo («un uso por cliente»).
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const price = Math.round(Number(body?.price))
  const quoteId = typeof body?.quoteId === 'string' ? body.quoteId.slice(0, 80) : ''
  if (!quoteId || !Number.isFinite(price) || price <= 0) return NextResponse.json({ error: 'Falta la cotización.' }, { status: 400 })
  if (!isValidEmail(String(body?.email || '').trim())) return NextResponse.json({ error: 'Escribe tu correo antes de aplicar un código.' }, { status: 400 })
  try {
    const customerId = await customerIdByEmail(body?.email)
    const { couponId: _couponId, ...coupon } = await quoteCoupon(body?.code, customerId, quoteId, price)
    return NextResponse.json({ ok: true, coupon })
  } catch (error) {
    if (error instanceof CouponError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('[quote/coupon] Error:', error)
    return NextResponse.json({ error: 'No pudimos revisar el código. Intenta de nuevo.' }, { status: 500 })
  }
}
