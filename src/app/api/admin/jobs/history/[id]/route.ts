import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getDriverNotesFor } from '@/lib/driverNotes'
import { DOCUMENT_FIELDS } from '@/lib/documents'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Lo que el equipo dejó en un trabajo del historial (Tomás, 21-10-2026: «al entrar a resumen
 * historial no se ven los comentarios ni las fotos»): notas del equipo, notas de la reserva y
 * fotos y documentos subidos. Solo lectura.
 */
export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  if (!UUID_RE.test(params.id)) return NextResponse.json({ error: 'Trabajo no encontrado' }, { status: 404 })
  const [{ data: booking }, notes, { data: documents }] = await Promise.all([
    supabaseAdmin.from('bookings').select('id, notes').eq('id', params.id).maybeSingle(),
    getDriverNotesFor([params.id]),
    supabaseAdmin.from('documents').select(DOCUMENT_FIELDS).eq('booking_id', params.id).order('created_at', { ascending: true }),
  ])
  if (!booking) return NextResponse.json({ error: 'Trabajo no encontrado' }, { status: 404 })
  return NextResponse.json({
    bookingNotes: booking.notes || null,
    teamNotes: (notes.get(params.id) || []).map((n) => ({ id: n.id, note: n.note, by: n.vehicle_label, at: n.created_at })),
    documents: documents || [],
  })
}
