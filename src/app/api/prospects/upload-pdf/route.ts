import { siteBaseUrl, toHiddenFileUrl } from '@/lib/fileLinks'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { MAX_PDF_BYTES, isPdfBuffer } from '@/lib/pdfUpload'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Guarda el PDF de una cotización. Solo por el id de la cotización, que se conoce al guardarla:
// antes también servía el correo, y con él cualquiera obtenía el PDF de otra persona.
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const pdfFile = formData.get('pdf') as File | null
    const prospectId = String(formData.get('prospectId') || '').trim()

    if (!UUID_RE.test(prospectId)) {
      return NextResponse.json({ error: 'prospectId es requerido' }, { status: 400 })
    }

    const { data: prospect, error: readError } = await supabaseAdmin
      .from('quote_prospects')
      .select('id, pdf_url')
      .eq('id', prospectId)
      .maybeSingle()

    if (readError) {
      console.error('[prospect-pdf] Error leyendo prospecto por ID:', readError)
      return NextResponse.json({ error: 'Error al procesar el PDF' }, { status: 500 })
    }
    if (!prospect) {
      return NextResponse.json({ error: 'No encontramos esa cotización' }, { status: 404 })
    }

    // Si el contenido cambia, `upsertQuoteProspect` descarta el PDF: el que está sigue vigente.
    const existing = prospect.pdf_url?.trim()
    if (existing) {
      return NextResponse.json({ success: true, pdfUrl: existing, skipped: true })
    }

    if (!pdfFile || pdfFile.size === 0) {
      return NextResponse.json({ error: 'Archivo PDF requerido' }, { status: 400 })
    }
    if (pdfFile.size > MAX_PDF_BYTES) {
      return NextResponse.json({ error: 'El PDF es demasiado grande' }, { status: 413 })
    }

    const buffer = Buffer.from(await pdfFile.arrayBuffer())
    if (!isPdfBuffer(buffer)) {
      return NextResponse.json({ error: 'El archivo no es un PDF' }, { status: 400 })
    }

    const filePath = `prospect-pdfs/prospect_${prospect.id}_${Date.now()}.pdf`
    const { error: uploadError } = await supabaseAdmin.storage
      .from('bookings')
      .upload(filePath, buffer, { contentType: 'application/pdf', upsert: true })

    if (uploadError) {
      console.error('[prospect-pdf] Error subiendo a Storage:', uploadError)
      return NextResponse.json({ error: 'Error al subir el PDF' }, { status: 500 })
    }

    const { data: urlData } = supabaseAdmin.storage.from('bookings').getPublicUrl(filePath)

    // Se guarda el link del sitio, no el del almacenamiento (ver lib/fileLinks.ts).
    const pdfUrl = toHiddenFileUrl(urlData.publicUrl, siteBaseUrl() || request.nextUrl.origin)

    const { error: updateError } = await supabaseAdmin
      .from('quote_prospects')
      .update({ pdf_url: pdfUrl, pdf_generated_at: new Date().toISOString() })
      .eq('id', prospect.id)

    if (updateError) {
      console.error('[prospect-pdf] Error actualizando la cotización:', updateError)
      return NextResponse.json({ error: 'Error al guardar el PDF' }, { status: 500 })
    }

    return NextResponse.json({ success: true, pdfUrl })
  } catch (error) {
    console.error('[prospect-pdf] Exception:', error)
    return NextResponse.json({ error: 'Error al procesar el PDF' }, { status: 500 })
  }
}
