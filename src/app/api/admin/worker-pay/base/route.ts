import { NextRequest, NextResponse } from 'next/server'
import { getActorFromRequest, logAdminAction } from '@/lib/activityLog'
import { WorkerPayError, setWorkerBase } from '@/lib/workerPay'

export const dynamic = 'force-dynamic'

const clp = (n: number | null) => (n ? `$${n.toLocaleString('es-CL')} al mes` : 'sin base')

/** Sueldo base mensual de un funcionario. Body: `{ workerId, amount }` (`null` o 0 = sin base). */
export async function PUT(request: NextRequest) {
  const actor = getActorFromRequest(request)
  const body = await request.json().catch(() => ({}))
  try {
    const result = await setWorkerBase(body?.workerId, body?.amount ?? null)
    await logAdminAction({
      actor,
      action: 'worker.base_changed',
      entityType: 'worker',
      entityId: String(body?.workerId),
      entityLabel: result.name,
      summary: `Cambió el sueldo base de ${result.name}: ${clp(result.to)}`,
      changes: { base: { from: clp(result.from), to: clp(result.to) } },
      request,
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof WorkerPayError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('[admin/worker-pay/base] Error:', error)
    return NextResponse.json({ error: 'No se pudo guardar el sueldo base' }, { status: 500 })
  }
}
