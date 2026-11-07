import { NextRequest, NextResponse } from 'next/server'
import { getActorFromRequest, logAdminAction } from '@/lib/activityLog'
import { hasAdminAction } from '@/lib/adminPermissions'
import { getMarketingConfig } from '@/lib/coupons'
import { getRecommenderReward, rewardLabel, setRecommenderReward } from '@/lib/recommenderReward'

export const dynamic = 'force-dynamic'

/** Premio de los recomendadores y, para comparar, el de los clientes. */
export async function GET() {
  const [{ available, reward }, { config }] = await Promise.all([getRecommenderReward(), getMarketingConfig()])
  const clients =
    config.pesosPerToken
      ? `1 crédito por cada $${config.pesosPerToken.toLocaleString('es-CL')} pagados`
      : config.rewardKind && config.rewardValue
        ? rewardLabel({ kind: config.rewardKind, value: config.rewardValue })
        : 'sin premio configurado'
  return NextResponse.json({ available, reward, label: reward ? rewardLabel(reward) : null, clients })
}

/** Body: `{ kind: 'monto' | 'porcentaje', value }`; value vacío = igual que los clientes. */
export async function PUT(request: NextRequest) {
  if (!(await hasAdminAction(request, 'pricing.edit'))) {
    return NextResponse.json({ error: 'Tu perfil puede ver este monto, pero no cambiarlo.' }, { status: 403 })
  }
  const actor = getActorFromRequest(request)
  const body = await request.json().catch(() => ({}))
  try {
    const reward = await setRecommenderReward(body, actor?.username || 'administrador')
    await logAdminAction({
      actor,
      action: 'settings.recommender_reward_changed',
      entityType: 'settings',
      entityLabel: 'Premio de recomendadores',
      summary: reward ? `Puso el premio de los recomendadores en ${rewardLabel(reward)}` : 'Los recomendadores vuelven a ganar lo mismo que los clientes',
      request,
    })
    return NextResponse.json({ ok: true, reward })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'No se pudo guardar.' }, { status: 400 })
  }
}
