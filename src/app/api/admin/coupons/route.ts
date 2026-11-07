import { NextRequest, NextResponse } from 'next/server'
import { getActorFromRequest, logAdminAction } from '@/lib/activityLog'
import { hasAdminAction } from '@/lib/adminPermissions'
import { CouponError, createManualCoupon, listAdminCoupons } from '@/lib/coupons'
import { couponValueLabel } from '@/lib/couponTypes'

export const dynamic = 'force-dynamic'

/** Cupones, códigos de referido y premios, con sus usos (sesión: middleware). */
export async function GET() {
  return NextResponse.json(await listAdminCoupons())
}

/** Crea un cupón de campaña. Solo el perfil Administrador: un cupón es plata que se deja de cobrar. */
export async function POST(request: NextRequest) {
  if (!(await hasAdminAction(request, 'marketing.manage'))) {
    return NextResponse.json({ error: 'Tu perfil no tiene permiso para crear cupones.' }, { status: 403 })
  }
  try {
    const actor = getActorFromRequest(request)
    const coupon = await createManualCoupon(await request.json().catch(() => ({})), actor?.username || 'administrador')
    await logAdminAction({
      actor,
      action: 'coupon.created',
      entityType: 'coupon',
      entityId: coupon.id,
      entityLabel: coupon.code,
      summary: `Creó el cupón ${coupon.code} (${couponValueLabel(coupon.kind, coupon.value)})`,
      changes: { created: { from: null, to: { code: coupon.code, kind: coupon.kind, value: coupon.value, max_uses: coupon.max_uses, valid_until: coupon.valid_until } } },
      request,
    })
    return NextResponse.json({ ok: true }, { status: 201 })
  } catch (error) {
    if (error instanceof CouponError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('[admin/coupons] Error creando:', error)
    return NextResponse.json({ error: 'No se pudo crear el cupón' }, { status: 500 })
  }
}
