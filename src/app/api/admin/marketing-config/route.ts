import { NextRequest, NextResponse } from 'next/server'
import { getActorFromRequest, logAdminAction } from '@/lib/activityLog'
import { hasAdminAction } from '@/lib/adminPermissions'
import { CouponError, getMarketingConfig, saveMarketingConfig } from '@/lib/coupons'

export const dynamic = 'force-dynamic'

/** Configuración del programa de referidos (sesión: middleware). */
export async function GET() {
  return NextResponse.json(await getMarketingConfig())
}

/**
 * Guarda el programa de referidos: encendido o apagado, cuánto recibe quien llega referido
 * y cuánto quien refirió. Solo el perfil Administrador.
 */
export async function PUT(request: NextRequest) {
  if (!(await hasAdminAction(request, 'marketing.manage'))) {
    return NextResponse.json({ error: 'Tu perfil no tiene permiso para cambiar el programa de referidos.' }, { status: 403 })
  }
  try {
    const actor = getActorFromRequest(request)
    const before = (await getMarketingConfig()).config
    const config = await saveMarketingConfig(await request.json().catch(() => ({})), actor?.username || 'administrador')
    await logAdminAction({
      actor,
      action: 'marketing.referrals_updated',
      entityType: 'marketing',
      entityLabel: 'Programa de referidos',
      summary: `${config.referralEnabled ? 'Dejó encendido' : 'Dejó apagado'} el programa de referidos`,
      changes: { config: { from: before, to: config } },
      request,
    })
    return NextResponse.json({ ok: true, config })
  } catch (error) {
    if (error instanceof CouponError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('[admin/marketing-config] Error:', error)
    return NextResponse.json({ error: 'No se pudo guardar la configuración' }, { status: 500 })
  }
}
