import { NextRequest, NextResponse } from 'next/server'
import { getActorFromRequest, logAdminAction } from '@/lib/activityLog'
import { WorkerPayError, setWorkerRate } from '@/lib/workerPay'

export const dynamic = 'force-dynamic'

/** Regla propia de un trabajador. Body: `{ workerId, mode: 'general' | 'fijo' | 'porcentaje' | 'm3km', value, perM3, perKm }`. */
export async function PUT(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const actor = getActorFromRequest(request)
  try {
    const result = await setWorkerRate(body?.workerId, body?.mode, body?.value, { perM3: body?.perM3, perKm: body?.perKm })
    await logAdminAction({
      actor,
      action: 'worker.rate_changed',
      entityType: 'worker',
      entityId: String(body?.workerId),
      entityLabel: result.name,
      summary: `Cambió la regla de pago de ${result.name}: ${result.to}`,
      changes: { tarifa: { from: result.from, to: result.to } },
      request,
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof WorkerPayError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('[admin/worker-pay/rate] Error:', error)
    return NextResponse.json({ error: 'No se pudo guardar la tarifa' }, { status: 500 })
  }
}
