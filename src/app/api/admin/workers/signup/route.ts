import { NextRequest, NextResponse } from 'next/server'
import { getActorFromRequest, logAdminAction } from '@/lib/activityLog'
import { WorkerError } from '@/lib/workers'
import { getPendingWorkers, getSignupLink, updateSignupLink, type SignupLinkAction } from '@/lib/workerSignup'

export const dynamic = 'force-dynamic'

/** El link de registro de trabajadores (con su clave) y cuántos esperan aprobación. Solo admin (middleware). */
export async function GET() {
  const [link, pending] = await Promise.all([getSignupLink(), getPendingWorkers()])
  return NextResponse.json({ ...link, pendingIds: pending.map((p) => p.id) })
}

const SUMMARY: Record<SignupLinkAction, string> = {
  open: 'Abrió el registro de trabajadores por link',
  rotate: 'Cambió el link de registro de trabajadores (el anterior dejó de servir)',
  close: 'Cerró el registro de trabajadores por link',
  'require-pin': 'El link de registro de trabajadores ahora pide clave',
  'no-pin': 'El link de registro de trabajadores ya no pide clave',
}

/** Body: `{ action: 'open' | 'rotate' | 'close' | 'require-pin' | 'no-pin' }`. */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const action = body?.action as SignupLinkAction
  if (!(action in SUMMARY)) return NextResponse.json({ error: 'Acción no válida' }, { status: 400 })
  try {
    const link = await updateSignupLink(action)
    await logAdminAction({
      actor: getActorFromRequest(request),
      action: `worker.signup_link_${action.replace('-', '_')}`,
      entityType: 'settings',
      entityLabel: 'Registro de trabajadores',
      summary: SUMMARY[action],
      request,
    })
    return NextResponse.json(link)
  } catch (error) {
    if (error instanceof WorkerError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('[admin/workers/signup] Error:', error)
    return NextResponse.json({ error: 'No se pudo cambiar el link de registro' }, { status: 500 })
  }
}
