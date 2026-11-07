import { NextRequest, NextResponse } from 'next/server'
import { getBookingContacts } from '@/lib/bookingContacts'

export const dynamic = 'force-dynamic'

/** Último contacto de cada reserva de la lista. Body: `{ ids: string[] }`. Solo lee. */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  try {
    return NextResponse.json({ contacts: await getBookingContacts(body?.ids) })
  } catch (error) {
    console.error('[admin/bookings/contacts] Error:', error)
    return NextResponse.json({ error: 'No se pudieron leer los contactos' }, { status: 500 })
  }
}
