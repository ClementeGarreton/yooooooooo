import { NextRequest, NextResponse } from 'next/server'
import { getActorFromRequest, logAdminAction } from '@/lib/activityLog'
import { WorkerPayError, setJobPay } from '@/lib/workerPay'

export const dynamic = 'force-dynamic'

/**
 * Cómo se le paga a una persona un trabajo (según su regla, monto a mano o por pallets) y los
 * datos del trabajo que mueven el cálculo (fuera de Santiago, pallets).
 * Body: `{ workerId, bookingId, mode?, amount?, pallets?, outsideSantiago? }`.
 */
export async function PUT(request: NextRequest) {
  const actor = getActorFromRequest(request)
  const body = await request.json().catch(() => ({}))
  try {
    const result = await setJobPay(body, actor?.username || 'administrador')
    if (Object.keys(result.changes).length > 0) {
      await logAdminAction({
        actor,
        action: 'worker_pay.job_changed',
        entityType: 'booking',
        entityId: String(body?.bookingId),
        entityLabel: result.label,
        summary: `Cambió el pago de ${result.name} en ${result.label}`,
        changes: result.changes,
        request,
      })
    }
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof WorkerPayError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('[admin/worker-pay/job] Error:', error)
    return NextResponse.json({ error: 'No se pudo guardar el pago del trabajo' }, { status: 500 })
  }
}
