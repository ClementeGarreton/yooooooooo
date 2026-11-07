import { NextRequest, NextResponse } from 'next/server'
import { getActorFromRequest, logAdminAction } from '@/lib/activityLog'
import { hasAdminAction } from '@/lib/adminPermissions'
import { getUfOfDay } from '@/lib/companyClosing'
import { getUfSetting, setUfSetting } from '@/lib/ufSetting'

export const dynamic = 'force-dynamic'

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date())

/** La UF puesta a mano (si hay) y la publicada hoy. */
export async function GET() {
  const [setting, ofDay] = await Promise.all([getUfSetting(), getUfOfDay(today())])
  return NextResponse.json({ ...setting, today: today(), ofDay })
}

/** Pone la UF a mano. Body: `{ value }`; `null` vuelve a usar la del día. */
export async function PUT(request: NextRequest) {
  if (!(await hasAdminAction(request, 'pricing.edit'))) {
    return NextResponse.json({ error: 'Tu perfil puede ver la UF, pero no cambiarla.' }, { status: 403 })
  }
  const actor = getActorFromRequest(request)
  const body = await request.json().catch(() => ({}))
  try {
    const result = await setUfSetting(body?.value ?? null, actor?.username || 'administrador')
    await logAdminAction({
      actor,
      action: 'settings.uf_changed',
      entityType: 'settings',
      entityLabel: 'Valor UF',
      summary: result.to === null ? 'Volvió a usar la UF del día' : `Puso la UF a mano en ${result.to.toLocaleString('es-CL')}`,
      changes: { uf: { from: result.from, to: result.to } },
      request,
    })
    return NextResponse.json({ ok: true, value: result.to })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'No se pudo guardar la UF.' }, { status: 400 })
  }
}
