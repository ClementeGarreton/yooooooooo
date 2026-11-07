import { NextRequest, NextResponse } from 'next/server'
import { getActorFromRequest, logAdminAction } from '@/lib/activityLog'
import { CompanyError, assignUnlinkedBooking, listUnlinkedCompanyBookings } from '@/lib/companies'

export const dynamic = 'force-dynamic'

/** Reservas marcadas «es empresa» que no están en ninguna empresa del panel (no se pueden facturar). */
export async function GET() {
  try {
    return NextResponse.json({ bookings: await listUnlinkedCompanyBookings() })
  } catch (error) {
    console.error('[admin/companies/sin-empresa] Error:', error)
    return NextResponse.json({ error: 'No se pudieron cargar las reservas sin empresa' }, { status: 500 })
  }
}

/** Asigna una de esas reservas a una empresa. Body: `{ bookingId, companyId }`. */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  try {
    const result = await assignUnlinkedBooking(body?.bookingId, body?.companyId)
    await logAdminAction({
      actor: getActorFromRequest(request),
      action: 'company.booking_assigned',
      entityType: 'booking',
      entityId: String(body.bookingId),
      entityLabel: result.booking,
      summary: `Asignó la reserva ${result.booking} (marcada como empresa) a ${result.company}`,
      request,
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof CompanyError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('[admin/companies/sin-empresa] Error asignando:', error)
    return NextResponse.json({ error: 'No se pudo asignar la reserva' }, { status: 500 })
  }
}
