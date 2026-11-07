import { NextRequest, NextResponse } from 'next/server'
import { logAdminAction } from '@/lib/activityLog'
import { WorkerError } from '@/lib/workers'
import { registerWorker } from '@/lib/workerSignup'

export const dynamic = 'force-dynamic'

/**
 * Registro de un trabajador desde el link de registro (sin sesión). Queda inactivo y
 * pendiente hasta que la oficina lo apruebe en Flota y equipo. El tope de intentos está en
 * el middleware (RATE_LIMIT_RULES).
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Solicitud inválida' }, { status: 400 })
  try {
    const worker = await registerWorker(body)
    await logAdminAction({
      actor: { username: `registro ${worker.code}` },
      action: 'worker.signed_up',
      entityType: 'worker',
      entityId: worker.id,
      entityLabel: `${worker.name} (${worker.code})`,
      summary: `${worker.name} se registró por el link de trabajadores: queda pendiente de aprobación`,
      request,
    })
    return NextResponse.json({ ok: true, name: worker.name })
  } catch (error) {
    if (error instanceof WorkerError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('[trabajos/registro] Error:', error)
    return NextResponse.json({ error: 'No pudimos registrarte. Intenta de nuevo.' }, { status: 500 })
  }
}
