import { NextRequest, NextResponse } from 'next/server'
import { getActorFromRequest, logAdminAction } from '@/lib/activityLog'
import { hasAdminAction } from '@/lib/adminPermissions'
import { CouponError, getMarketingConfig, referralsLive } from '@/lib/coupons'
import { createRecommender, listRecommenders } from '@/lib/recommenders'

export const dynamic = 'force-dynamic'

/** Recomendadores (conserjes) con su seguimiento de usos, créditos y pagos. */
export async function GET() {
  const [list, { available, config }] = await Promise.all([listRecommenders(), getMarketingConfig()])
  return NextResponse.json({ ...list, programLive: available && referralsLive(config) })
}

/** Agrega un recomendador. Body: `{ name, email, phone?, place? }`. */
export async function POST(request: NextRequest) {
  if (!(await hasAdminAction(request, 'marketing.manage'))) {
    return NextResponse.json({ error: 'Tu perfil no puede crear cupones ni recomendadores.' }, { status: 403 })
  }
  const body = await request.json().catch(() => ({}))
  try {
    const result = await createRecommender(body)
    await logAdminAction({
      actor: getActorFromRequest(request),
      action: 'coupon.recommender_created',
      entityType: 'customer',
      entityId: result.customerId,
      entityLabel: result.name,
      summary: `Agregó al recomendador ${result.name} con el código ${result.code}`,
      request,
    })
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof CouponError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('[admin/coupons/recomendadores] Error:', error)
    return NextResponse.json({ error: 'No se pudo agregar al recomendador' }, { status: 500 })
  }
}
