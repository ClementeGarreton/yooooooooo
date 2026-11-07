import { NextRequest, NextResponse } from 'next/server'
import { getActorFromRequest, logAdminAction } from '@/lib/activityLog'
import { hasAdminAction } from '@/lib/adminPermissions'
import { WorkerPayError, closeWorkerPeriods, reopenClosing } from '@/lib/workerPay'

export const dynamic = 'force-dynamic'

function fail(error: unknown, fallback: string) {
  if (error instanceof WorkerPayError) return NextResponse.json({ error: error.message }, { status: error.status })
  console.error('[admin/worker-pay/closing] Error:', error)
  return NextResponse.json({ error: fallback }, { status: 500 })
}

const day = (d: string) => d.split('-').reverse().join('-')

/** Cierra el período para los funcionarios elegidos. Body: `{ workerIds, from, to, notes }`. */
export async function POST(request: NextRequest) {
  const actor = getActorFromRequest(request)
  try {
    const body = await request.json().catch(() => ({}))
    const result = await closeWorkerPeriods(body, actor?.username || 'administrador')
    if (result.closed.length > 0) {
      await logAdminAction({
        actor,
        action: 'worker_pay.period_closed',
        entityType: 'worker',
        entityLabel: `${day(String(body?.from))} al ${day(String(body?.to))}`,
        summary: `Cerró el pago del ${day(String(body?.from))} al ${day(String(body?.to))} de ${result.closed.join(', ')}`,
        request,
      })
    }
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    return fail(error, 'No se pudo cerrar el período')
  }
}

/** Reabre un cierre. `?id=`. Solo el perfil Administrador. */
export async function DELETE(request: NextRequest) {
  const actor = getActorFromRequest(request)
  try {
    if (!(await hasAdminAction(request, 'users.manage'))) {
      return NextResponse.json({ error: 'Solo un Administrador puede reabrir un período cerrado.' }, { status: 403 })
    }
    const result = await reopenClosing(request.nextUrl.searchParams.get('id'), actor?.username || 'administrador')
    await logAdminAction({
      actor,
      action: 'worker_pay.period_reopened',
      entityType: 'worker',
      entityLabel: result.name,
      summary: `Reabrió el pago del ${day(result.from)} al ${day(result.to)} de ${result.name}`,
      request,
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return fail(error, 'No se pudo reabrir el período')
  }
}
