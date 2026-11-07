import { NextRequest, NextResponse } from 'next/server'
import { customerIdFromRequest } from '@/lib/customerSession'
import { getDocumentScope, getVisibleDocument } from '@/lib/customerDocuments'
import { documentResponse } from '@/lib/documents'

export const dynamic = 'force-dynamic'

/**
 * Abre (o con `?descargar=1`, descarga) un documento que la persona puede ver. Redirige a
 * una URL firmada de pocos minutos: el link que queda en el historial del navegador deja
 * de servir solo. Un documento ajeno responde 404, igual que uno inexistente.
 */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const customerId = await customerIdFromRequest(request)
  if (!customerId) return NextResponse.redirect(new URL('/mi-cuenta/ingresar', request.url))

  const scope = await getDocumentScope(customerId)
  const doc = await getVisibleDocument(scope, params.id)
  if (!doc) return NextResponse.json({ error: 'Documento no encontrado' }, { status: 404 })

  try {
    return await documentResponse(doc, request.nextUrl.searchParams.get('descargar') === '1')
  } catch (error) {
    console.error('[cuenta/documentos] Error firmando:', error)
    return NextResponse.json({ error: 'No pudimos abrir el documento' }, { status: 500 })
  }
}
