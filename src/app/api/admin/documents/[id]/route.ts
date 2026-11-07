import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { documentResponse } from '@/lib/documents'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Abre (o con `?descargar=1`, descarga) cualquier documento desde el admin (sesión:
 * middleware). El archivo se entrega desde el servidor: el navegador no ve el almacenamiento.
 */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  if (!UUID_RE.test(params.id)) return NextResponse.json({ error: 'Documento no encontrado' }, { status: 404 })
  const { data: doc } = await supabaseAdmin
    .from('documents')
    .select('storage_path, file_name')
    .eq('id', params.id)
    .maybeSingle()
  if (!doc) return NextResponse.json({ error: 'Documento no encontrado' }, { status: 404 })

  try {
    return await documentResponse(doc, request.nextUrl.searchParams.get('descargar') === '1')
  } catch (error) {
    console.error('[admin/documents] Error firmando:', error)
    return NextResponse.json({ error: 'No se pudo abrir el documento' }, { status: 500 })
  }
}
