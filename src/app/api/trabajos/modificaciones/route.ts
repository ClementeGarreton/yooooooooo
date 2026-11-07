import { NextRequest, NextResponse } from 'next/server'
import { resolveWorkerUploadTarget } from '@/lib/workerUploadTarget'
import { ModificationError, createModification } from '@/lib/bookingModifications'

export const dynamic = 'force-dynamic'

/**
 * El trabajador registra una diferencia contra lo cotizado en un trabajo de SU agenda.
 * Body: `{ bookingId, field, original, found, note }`. Queda pendiente: no cambia nada en
 * la reserva hasta que la administración la aprueba.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Solicitud inválida' }, { status: 400 })

  // Misma comprobación que las subidas: sesión del trabajador + trabajo en su agenda.
  const target = await resolveWorkerUploadTarget(body.bookingId)
  if (!target.ok) return NextResponse.json({ error: target.error }, { status: target.status })

  try {
    if (!target.bookingId) return NextResponse.json({ error: 'Falta indicar el trabajo' }, { status: 400 })
    const modification = await createModification(target.worker, target.bookingId, body)
    return NextResponse.json({ ok: true, modification }, { status: 201 })
  } catch (error) {
    if (error instanceof ModificationError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('[trabajos/modificaciones] Error:', error)
    return NextResponse.json({ error: 'No se pudo registrar la diferencia. Intenta de nuevo.' }, { status: 500 })
  }
}
