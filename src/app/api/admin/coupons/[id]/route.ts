import { NextRequest, NextResponse } from 'next/server'
import { getActorFromRequest, logAdminAction } from '@/lib/activityLog'
import { hasAdminAction } from '@/lib/adminPermissions'
import { CouponError, setCouponActive, updateManualCoupon } from '@/lib/coupons'

export const dynamic = 'force-dynamic'

/**
 * Activa o desactiva un cupón (body `{ active }`), o cambia las condiciones de un cupón de
 * campaña (body `{ minAmount, maxDiscount, maxUses, validFrom, validUntil, description }`).
 * Solo el perfil Administrador.
 */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  if (!(await hasAdminAction(request, 'marketing.manage'))) {
    return NextResponse.json({ error: 'Tu perfil no tiene permiso para cambiar cupones.' }, { status: 403 })
  }
  try {
    const body = await request.json().catch(() => ({}))
    if (!('active' in (body || {}))) {
      const result = await updateManualCoupon(params.id, body)
      await logAdminAction({
        actor: getActorFromRequest(request),
        action: 'coupon.updated',
        entityType: 'coupon',
        entityId: params.id,
        entityLabel: result.code,
        summary: `Cambió las condiciones del cupón ${result.code}`,
        changes: result.changes,
        request,
      })
      return NextResponse.json({ ok: true })
    }
    const active = body?.active === true
    const coupon = await setCouponActive(params.id, active)
    await logAdminAction({
      actor: getActorFromRequest(request),
      action: active ? 'coupon.activated' : 'coupon.deactivated',
      entityType: 'coupon',
      entityId: coupon.id,
      entityLabel: coupon.code,
      summary: `${active ? 'Activó' : 'Desactivó'} el cupón ${coupon.code}`,
      changes: { active: { from: !active, to: active } },
      request,
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof CouponError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('[admin/coupons] Error:', error)
    return NextResponse.json({ error: 'No se pudo cambiar el cupón' }, { status: 500 })
  }
}
