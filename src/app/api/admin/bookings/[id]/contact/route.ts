import { NextRequest, NextResponse } from 'next/server'
import { recordBookingContact } from '@/lib/bookingContacts'

export const dynamic = 'force-dynamic'

/** Registra que se abrió el WhatsApp o el correo del cliente. Body: `{ channel: 'whatsapp' | 'email' }`. */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const body = await request.json().catch(() => ({}))
  const contact = await recordBookingContact(request, params.id, body?.channel)
  if (!contact) return NextResponse.json({ error: 'Reserva no encontrada' }, { status: 404 })
  return NextResponse.json({ ok: true, contact })
}
