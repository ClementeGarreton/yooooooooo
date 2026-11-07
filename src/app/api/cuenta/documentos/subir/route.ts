import { NextRequest, NextResponse } from 'next/server'
import { customerIdFromRequest } from '@/lib/customerSession'
import { resolveCustomerUploadTarget } from '@/lib/customerUploadTarget'
import { createUploadTickets, DocumentUploadError } from '@/lib/documents'

export const dynamic = 'force-dynamic'

/**
 * Paso 1 de subir documentos desde el Panel del Cliente: permisos firmados para subir los
 * archivos directo al bucket privado (no pasan por el servidor: ver createUploadTickets).
 * Body: `{ files: [{ name, size, type }], bookingId? }`.
 */
export async function POST(request: NextRequest) {
  const customerId = await customerIdFromRequest(request)
  if (!customerId) return NextResponse.json({ error: 'Tu sesión venció. Vuelve a entrar.' }, { status: 401 })

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Solicitud inválida' }, { status: 400 })
  }

  const target = await resolveCustomerUploadTarget(customerId, body?.bookingId)
  if (!target.ok) return NextResponse.json({ error: target.error }, { status: target.status })

  const files = Array.isArray(body?.files)
    ? body.files.map((f: any) => ({ name: String(f?.name || 'archivo'), size: Number(f?.size) || 0, type: String(f?.type || '') }))
    : []

  try {
    const tickets = await createUploadTickets(target.folder, files)
    return NextResponse.json({ ok: true, tickets })
  } catch (error) {
    if (error instanceof DocumentUploadError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('[cuenta/documentos/subir] Error:', error)
    return NextResponse.json({ error: 'No pudimos preparar la subida. Intenta de nuevo.' }, { status: 500 })
  }
}
