import { NextRequest, NextResponse } from 'next/server'
import { getActorFromRequest, logAdminAction } from '@/lib/activityLog'
import { WorkerPayError, setWorkerPayProfile } from '@/lib/workerPay'

export const dynamic = 'force-dynamic'

/** Mínimo por trabajo y datos bancarios de un funcionario. Body: `{ workerId, minPerJob?, bankCode?, bankAccountType?, bankAccountNumber? }`. */
export async function PUT(request: NextRequest) {
  const actor = getActorFromRequest(request)
  const body = await request.json().catch(() => ({}))
  try {
    const result = await setWorkerPayProfile(body)
    if (Object.keys(result.changes).length > 0) {
      await logAdminAction({
        actor,
        action: 'worker.pay_profile_changed',
        entityType: 'worker',
        entityId: String(body?.workerId),
        entityLabel: result.name,
        summary: `Cambió el mínimo por trabajo o los datos bancarios de ${result.name}`,
        changes: result.changes,
        request,
      })
    }
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof WorkerPayError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('[admin/worker-pay/profile] Error:', error)
    return NextResponse.json({ error: 'No se pudieron guardar los datos' }, { status: 500 })
  }
}
