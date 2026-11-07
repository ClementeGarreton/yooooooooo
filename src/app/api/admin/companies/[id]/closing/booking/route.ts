import { NextRequest, NextResponse } from 'next/server'
import { getActorFromRequest, logAdminAction } from '@/lib/activityLog'
import { CompanyClosingError, setDeliveryData } from '@/lib/companyClosing'

export const dynamic = 'force-dynamic'

/** Corrige la entrega de un trabajo de la empresa. Body: `{ bookingId, pallets?, kg?, odNumber?, guideNumber?, urgent?, repalletize?, note? }`. */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const body = await request.json().catch(() => ({}))
  try {
    const result = await setDeliveryData(body?.bookingId, body, { admin: true, companyId: params.id })
    if (Object.keys(result.changes).length > 0) {
      await logAdminAction({
        actor: getActorFromRequest(request),
        action: 'booking.delivery_changed',
        entityType: 'booking',
        entityId: String(body?.bookingId),
        entityLabel: result.label,
        summary: `Cambió los datos de la entrega de ${result.label}`,
        changes: result.changes,
        request,
      })
    }
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof CompanyClosingError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('[admin/companies/closing/booking] Error:', error)
    return NextResponse.json({ error: 'No se pudo guardar la entrega' }, { status: 500 })
  }
}
