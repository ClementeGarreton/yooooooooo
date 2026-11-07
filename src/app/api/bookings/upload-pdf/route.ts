import { siteBaseUrl, toHiddenFileUrl } from '@/lib/fileLinks'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { MAX_PDF_BYTES, isPdfBuffer } from '@/lib/pdfUpload'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const QUOTE_ID_RE = /^[A-Za-z0-9_-]{1,80}$/

// Guarda el comprobante que arman las páginas de pago exitoso. Es pública, así que solo guarda el
// primero de una reserva ya pagada: antes cualquiera podía reemplazar el PDF de una reserva, y se
// guardaba el archivo aunque la reserva no existiera.
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const pdfFile = formData.get('pdf') as File | null
    const quoteId = String(formData.get('quoteId') || '').trim()
    const bookingId = String(formData.get('bookingId') || '').trim()

    if (!pdfFile || (!UUID_RE.test(bookingId) && !QUOTE_ID_RE.test(quoteId))) {
      return NextResponse.json({ error: 'PDF y (quoteId o bookingId) son requeridos' }, { status: 400 })
    }
    if (pdfFile.size === 0 || pdfFile.size > MAX_PDF_BYTES) {
      return NextResponse.json({ error: 'El tamaño del PDF no es válido' }, { status: 413 })
    }

    const lookup = supabaseAdmin.from('bookings').select('id, quote_id, pdf_url, payment_status')
    const { data: booking, error: readError } = await (UUID_RE.test(bookingId)
      ? lookup.eq('id', bookingId).maybeSingle()
      : lookup.eq('quote_id', quoteId).maybeSingle())

    if (readError) {
      console.error('[upload-pdf] Error leyendo la reserva:', readError)
      return NextResponse.json({ error: 'Error al procesar el PDF' }, { status: 500 })
    }
    if (!booking) {
      // Hay que saberlo: el cliente llegó a «pago exitoso» y no hay reserva.
      console.error('[upload-pdf] Comprobante de una reserva que no existe:', bookingId || quoteId)
      return NextResponse.json({ error: 'No se encontró la reserva' }, { status: 404 })
    }
    if (booking.pdf_url?.trim()) {
      return NextResponse.json({ success: true, skipped: true })
    }
    if (booking.payment_status !== 'approved') {
      return NextResponse.json({ error: 'La reserva no tiene un pago aprobado' }, { status: 409 })
    }

    const buffer = Buffer.from(await pdfFile.arrayBuffer())
    if (!isPdfBuffer(buffer)) {
      return NextResponse.json({ error: 'El archivo no es un PDF' }, { status: 400 })
    }

    // (Auditoría 2026-11-04 §6.6/N10) El timestamp no era un secreto: cualquiera que
    // conociera el código de la cotización podía reconstruir la ruta. El UUID es ahora la
    // única parte impredecible; el código queda delante para poder rastrear el archivo.
    const filePath = `booking-pdfs/${booking.quote_id || booking.id}_${globalThis.crypto.randomUUID()}.pdf`
    const { error: uploadError } = await supabaseAdmin.storage
      .from('bookings')
      .upload(filePath, buffer, { contentType: 'application/pdf', upsert: true })

    if (uploadError) {
      console.error('[upload-pdf] Error al subir a Storage:', uploadError)
      return NextResponse.json({ error: 'Error al subir el PDF' }, { status: 500 })
    }

    const { data: urlData } = supabaseAdmin.storage.from('bookings').getPublicUrl(filePath)

    // Se guarda el link del sitio, no el del almacenamiento (ver lib/fileLinks.ts).
    const pdfUrl = toHiddenFileUrl(urlData.publicUrl, siteBaseUrl() || request.nextUrl.origin)

    const { error: updateError } = await supabaseAdmin
      .from('bookings')
      .update({ pdf_url: pdfUrl, pdf_generated_at: new Date().toISOString() })
      .eq('id', booking.id)

    if (updateError) {
      console.error('[upload-pdf] Error al actualizar la reserva:', updateError)
      return NextResponse.json({ error: 'Error al guardar el PDF' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error in /api/bookings/upload-pdf:', error)
    return NextResponse.json({ error: 'Error al procesar el PDF' }, { status: 500 })
  }
}
