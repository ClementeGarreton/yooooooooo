import { NextRequest, NextResponse } from 'next/server'
import { getActorFromRequest, logAdminAction } from '@/lib/activityLog'
import { WorkerPayError, addWorkerBonus, removeWorkerBonus } from '@/lib/workerPay'

export const dynamic = 'force-dynamic'

function fail(error: unknown) {
  if (error instanceof WorkerPayError) return NextResponse.json({ error: error.message }, { status: error.status })
  console.error('[admin/worker-pay/bonus] Error:', error)
  return NextResponse.json({ error: 'No se pudo guardar la bonificación' }, { status: 500 })
}

/** Carga una bonificación. Body: `{ workerId, amount, date, note? }`. */
export async function POST(request: NextRequest) {
  const actor = getActorFromRequest(request)
  try {
    const result = await addWorkerBonus(await request.json().catch(() => ({})), actor?.username || 'administrador')
    await logAdminAction({
      actor,
      action: 'worker.bonus_added',
      entityType: 'worker',
      entityLabel: result.name,
      summary: `Cargó una bonificación de $${result.amount.toLocaleString('es-CL')} a ${result.name}`,
      request,
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return fail(error)
  }
}

/** Quita una bonificación cargada por error. `?id=`. */
export async function DELETE(request: NextRequest) {
  const actor = getActorFromRequest(request)
  try {
    const result = await removeWorkerBonus(request.nextUrl.searchParams.get('id'))
    await logAdminAction({
      actor,
      action: 'worker.bonus_removed',
      entityType: 'worker',
      entityLabel: result.name,
      summary: `Quitó una bonificación de $${result.amount.toLocaleString('es-CL')} a ${result.name}`,
      request,
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return fail(error)
  }
}
