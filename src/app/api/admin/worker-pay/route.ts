import { NextRequest, NextResponse } from 'next/server'
import { getActorFromRequest, logAdminAction } from '@/lib/activityLog'
import { WorkerPayError, getWorkerPay, recordWorkerPayment } from '@/lib/workerPay'

export const dynamic = 'force-dynamic'

function fail(error: unknown, fallback: string) {
  if (error instanceof WorkerPayError) return NextResponse.json({ error: error.message }, { status: error.status })
  console.error('[admin/worker-pay] Error:', error)
  return NextResponse.json({ error: fallback }, { status: 500 })
}

/** Trabajos realizados por cada trabajador en `?desde=&hasta=`, lo que se le debe y lo pagado. */
export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams
    return NextResponse.json(await getWorkerPay(params.get('desde'), params.get('hasta')))
  } catch (error) {
    return fail(error, 'No se pudo cargar el pago a trabajadores')
  }
}

/**
 * Registra un pago hecho. Body: `{ workerId, from, to, items: [{ kind, ref }], method?, note? }`.
 * El monto lo calcula el servidor con lo marcado. Sin `items`, acepta `amount` a mano.
 */
export async function POST(request: NextRequest) {
  const actor = getActorFromRequest(request)
  try {
    const result = await recordWorkerPayment(await request.json().catch(() => ({})), actor?.username || 'administrador')
    await logAdminAction({
      actor,
      action: 'worker.payment_recorded',
      entityType: 'worker',
      entityLabel: result.name,
      summary: `Registró un pago de $${result.amount.toLocaleString('es-CL')} a ${result.name}${result.items ? ` (${result.items} ítem${result.items === 1 ? '' : 's'})` : ''}`,
      request,
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return fail(error, 'No se pudo registrar el pago')
  }
}
