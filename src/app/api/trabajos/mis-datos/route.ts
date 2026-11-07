import { NextRequest, NextResponse } from 'next/server'
import { logAdminAction } from '@/lib/activityLog'
import { getSessionWorker } from '@/lib/workerSession'
import { WorkerError } from '@/lib/workers'
import { updateWorkerOwnData } from '@/lib/workerSignup'

export const dynamic = 'force-dynamic'

/**
 * El trabajador con sesión cambia su teléfono, correo o datos bancarios. Body: `{ phone?,
 * email?, bankCode?, bankAccountType?, bankAccountNumber? }`. Cada cambio queda en el
 * registro de actividad del admin (el número de cuenta, sin el número).
 */
export async function PUT(request: NextRequest) {
  const worker = await getSessionWorker()
  if (!worker) return NextResponse.json({ error: 'Tu sesión venció. Vuelve a entrar.' }, { status: 401 })
  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Solicitud inválida' }, { status: 400 })
  try {
    const result = await updateWorkerOwnData(worker.id, body)
    if (Object.keys(result.changes).length > 0) {
      await logAdminAction({
        actor: { username: `${worker.name} · ${worker.code}` },
        action: 'worker.own_data_changed',
        entityType: 'worker',
        entityId: worker.id,
        entityLabel: `${worker.name} (${worker.code})`,
        summary: `${worker.name} cambió sus datos desde /trabajos: ${Object.keys(result.changes).join(', ')}`,
        changes: result.changes,
        request,
      })
    }
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof WorkerError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('[trabajos/mis-datos] Error:', error)
    return NextResponse.json({ error: 'No pudimos guardar tus datos. Intenta de nuevo.' }, { status: 500 })
  }
}
