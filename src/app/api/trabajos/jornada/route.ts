import { NextRequest, NextResponse } from 'next/server'
import { resolveWorkerUploadTarget } from '@/lib/workerUploadTarget'
import { WorkLogError, finishWork, startWork } from '@/lib/workLogs'

export const dynamic = 'force-dynamic'

/**
 * El trabajador marca el inicio o el fin de un trabajo de SU agenda.
 * Body: `{ bookingId, action: 'iniciar' | 'finalizar', force? }`. `force` es la confirmación
 * de la advertencia cuando ya tiene otro trabajo iniciado.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  if (!body || (body.action !== 'iniciar' && body.action !== 'finalizar')) {
    return NextResponse.json({ error: 'Solicitud inválida' }, { status: 400 })
  }

  // Misma comprobación que notas y diferencias: sesión del trabajador + trabajo suyo.
  const target = await resolveWorkerUploadTarget(body.bookingId)
  if (!target.ok) return NextResponse.json({ error: target.error }, { status: target.status })
  if (!target.bookingId) return NextResponse.json({ error: 'Falta indicar el trabajo' }, { status: 400 })

  try {
    const log =
      body.action === 'iniciar'
        ? await startWork(target.worker, target.bookingId, body.force === true)
        : await finishWork(target.worker.id, target.bookingId)
    return NextResponse.json({ ok: true, log })
  } catch (error) {
    if (error instanceof WorkLogError) {
      return NextResponse.json({ error: error.message, open: error.open }, { status: error.status })
    }
    console.error('[trabajos/jornada] Error:', error)
    return NextResponse.json({ error: 'No se pudo guardar. Intenta de nuevo.' }, { status: 500 })
  }
}
