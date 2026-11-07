import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getSessionWorker } from '@/lib/workerSession'
import { documentResponse } from '@/lib/documents'
import { UUID_RE } from '@/lib/workers'
import { getActivePreview } from '@/lib/adminPreviewServer'

export const dynamic = 'force-dynamic'

/**
 * Abre un archivo que subió ESTE trabajador (URL firmada de pocos minutos). Los que subió
 * otra persona —el cliente u otro trabajador— responden 404, igual que uno inexistente.
 *
 * En la vista de administrador («Ver como») no hay sesión del trabajador: vale el trabajador
 * que se está mirando, y solo para leer.
 */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const preview = await getActivePreview('worker')
  const worker = preview ? { id: preview.id } : await getSessionWorker()
  if (!worker) return NextResponse.redirect(new URL('/trabajos', request.url))
  if (!UUID_RE.test(params.id)) return NextResponse.json({ error: 'Documento no encontrado' }, { status: 404 })

  const { data: doc } = await supabaseAdmin
    .from('documents')
    .select('storage_path, file_name')
    .eq('id', params.id)
    .eq('uploaded_by_type', 'trabajador')
    .eq('uploaded_by_id', worker.id)
    .maybeSingle()
  if (!doc) return NextResponse.json({ error: 'Documento no encontrado' }, { status: 404 })

  try {
    return await documentResponse(doc, request.nextUrl.searchParams.get('descargar') === '1')
  } catch (error) {
    console.error('[trabajos/documentos] Error firmando:', error)
    return NextResponse.json({ error: 'No pudimos abrir el documento' }, { status: 500 })
  }
}
