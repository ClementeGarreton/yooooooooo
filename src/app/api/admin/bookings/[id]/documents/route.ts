import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { DOCUMENT_FIELDS } from '@/lib/documents'

export const dynamic = 'force-dynamic'

/** Fotos y documentos de una reserva, para el detalle del admin (sesión: middleware). */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const { data, error } = await supabaseAdmin
    .from('documents')
    .select(DOCUMENT_FIELDS)
    .eq('booking_id', params.id)
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) {
    console.error('[admin/bookings/documents] Error:', error)
    return NextResponse.json({ error: 'No se pudieron cargar los documentos' }, { status: 500 })
  }
  return NextResponse.json({ documents: data || [] })
}
