import { NextRequest, NextResponse } from 'next/server'
import { customerIdFromRequest } from '@/lib/customerSession'
import { resolveCustomerUploadTarget } from '@/lib/customerUploadTarget'
import { confirmUploads, DocumentUploadError, type DocumentKind } from '@/lib/documents'

export const dynamic = 'force-dynamic'

/**
 * Paso 3 de subir documentos: el navegador avisa que terminó de subir y el servidor
 * revisa cada archivo de verdad (carpeta, peso y primeros bytes) antes de registrarlo.
 * Body: `{ items: [{ path, fileName }], kind, bookingId?, note? }`.
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

  const items = Array.isArray(body?.items)
    ? body.items.map((i: any) => ({ path: String(i?.path || ''), fileName: String(i?.fileName || '') }))
    : []
  const kind: DocumentKind = body?.kind === 'foto' ? 'foto' : 'documento'

  try {
    const saved = await confirmUploads({
      folder: target.folder,
      items,
      uploader: { type: 'cliente', id: customerId, label: target.label },
      bookingId: target.bookingId,
      customerId,
      companyId: target.companyId,
      kind,
      note: typeof body?.note === 'string' ? body.note : null,
    })
    return NextResponse.json({ ok: true, count: saved.length })
  } catch (error) {
    if (error instanceof DocumentUploadError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('[cuenta/documentos/confirmar] Error:', error)
    return NextResponse.json({ error: 'No pudimos registrar los archivos. Intenta de nuevo.' }, { status: 500 })
  }
}
