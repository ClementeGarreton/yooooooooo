import { NextRequest, NextResponse } from 'next/server'
import { getActorFromRequest, logAdminAction } from '@/lib/activityLog'
import { UUID_RE, WorkerError } from '@/lib/workers'
import { decideSignup } from '@/lib/workerSignup'

export const dynamic = 'force-dynamic'

/** Aprueba o rechaza a alguien que se registró por el link. Body: `{ approve: boolean, vehicle_id? }`. */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  if (!UUID_RE.test(params.id)) return NextResponse.json({ error: 'Trabajador no encontrado' }, { status: 404 })
  const body = await request.json().catch(() => ({}))
  try {
    const approve = body?.approve === true
    const vehicle = Number(body?.vehicle_id)
    const result = await decideSignup(params.id, approve, body?.vehicle_id === null || body?.vehicle_id === undefined || body?.vehicle_id === '' || !Number.isInteger(vehicle) ? null : vehicle)
    await logAdminAction({
      actor: getActorFromRequest(request),
      action: approve ? 'worker.signup_approved' : 'worker.signup_rejected',
      entityType: 'worker',
      entityId: params.id,
      entityLabel: `${result.name} (${result.code})`,
      summary: `${approve ? 'Aprobó' : 'Rechazó'} el registro de ${result.name}`,
      request,
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof WorkerError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('[admin/workers/approval] Error:', error)
    return NextResponse.json({ error: 'No se pudo guardar' }, { status: 500 })
  }
}
