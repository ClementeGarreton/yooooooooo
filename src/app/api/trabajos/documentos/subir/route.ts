import { NextRequest, NextResponse } from 'next/server'
import { resolveWorkerUploadTarget } from '@/lib/workerUploadTarget'
import { createUploadTickets, DocumentUploadError } from '@/lib/documents'

export const dynamic = 'force-dynamic'

/**
 * Paso 1 de subir fotos, gastos o documentos desde el panel del trabajador: permisos
 * firmados para subir directo al bucket. Body: `{ bookingId, files: [{ name, size, type }] }`.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Solicitud inválida' }, { status: 400 })

  // Sin reserva = documento personal del trabajador.
  const target = await resolveWorkerUploadTarget(body.bookingId, { allowPersonal: true })
  if (!target.ok) return NextResponse.json({ error: target.error }, { status: target.status })

  const files = Array.isArray(body.files)
    ? body.files.map((f: any) => ({ name: String(f?.name || 'archivo'), size: Number(f?.size) || 0, type: String(f?.type || '') }))
    : []

  try {
    return NextResponse.json({ ok: true, tickets: await createUploadTickets(target.folder, files) })
  } catch (error) {
    if (error instanceof DocumentUploadError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('[trabajos/documentos/subir] Error:', error)
    return NextResponse.json({ error: 'No pudimos preparar la subida. Intenta de nuevo.' }, { status: 500 })
  }
}
