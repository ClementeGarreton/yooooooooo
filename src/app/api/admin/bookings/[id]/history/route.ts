import { NextResponse } from 'next/server'
import { getBookingHistory } from '@/lib/bookingModifications'

export const dynamic = 'force-dynamic'

/** Historial auditable de una reserva: solicitud, cambios con su usuario y modificaciones en terreno. */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  return NextResponse.json({ events: await getBookingHistory(params.id) })
}
