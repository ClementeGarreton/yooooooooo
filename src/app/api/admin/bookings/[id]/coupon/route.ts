import { NextRequest, NextResponse } from 'next/server'
import { getActorFromRequest, logAdminAction } from '@/lib/activityLog'
import { CouponError, applyCouponToBooking, getBookingCoupon, removeCouponFromBooking } from '@/lib/coupons'

export const dynamic = 'force-dynamic'

function fail(error: unknown, fallback: string) {
  if (error instanceof CouponError) return NextResponse.json({ error: error.message }, { status: error.status })
  console.error('[admin/bookings/coupon] Error:', error)
  return NextResponse.json({ error: fallback }, { status: 500 })
}

/** Código (cupón o referido) aplicado a la reserva, o `null`. */
export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    return NextResponse.json({ coupon: await getBookingCoupon(params.id) })
  } catch (error) {
    return fail(error, 'No se pudo leer el código de la reserva')
  }
}

/** Aplica un código a la reserva. Body: `{ code }`. Rebaja el precio y registra el uso. */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const body = await request.json().catch(() => ({}))
  const actor = getActorFromRequest(request)
  try {
    const coupon = await applyCouponToBooking(params.id, body?.code, actor?.username || 'administrador')
    await logAdminAction({
      actor,
      action: 'booking.coupon_applied',
      entityType: 'booking',
      entityId: params.id,
      entityLabel: `Código ${coupon.code}`,
      summary: `Aplicó el código ${coupon.code} (${coupon.origin === 'referido' ? 'referido' : 'cupón'}): −$${coupon.discount.toLocaleString('es-CL')}`,
      changes: { precio: { from: coupon.amountBefore, to: coupon.amountAfter } },
      request,
    })
    return NextResponse.json({ ok: true, coupon })
  } catch (error) {
    return fail(error, 'No se pudo aplicar el código')
  }
}

/** Quita el código de la reserva y le devuelve el precio anterior. */
export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const actor = getActorFromRequest(request)
  try {
    const removed = await removeCouponFromBooking(params.id, actor?.username || 'administrador')
    await logAdminAction({
      actor,
      action: 'booking.coupon_removed',
      entityType: 'booking',
      entityId: params.id,
      entityLabel: `Código ${removed.code}`,
      summary: `Quitó el código ${removed.code} de la reserva`,
      request,
    })
    return NextResponse.json({ ok: true, restoredPrice: removed.restoredPrice })
  } catch (error) {
    return fail(error, 'No se pudo quitar el código')
  }
}
