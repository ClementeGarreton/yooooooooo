import { NextRequest, NextResponse } from 'next/server'
import { resolveWorkerUploadTarget } from '@/lib/workerUploadTarget'
import { CompanyClosingError, setDeliveryData } from '@/lib/companyClosing'
import { logAdminAction } from '@/lib/activityLog'

export const dynamic = 'force-dynamic'

/**
 * El trabajador anota la entrega de un trabajo de empresa: pallets o kilos, N° de OD y N° de
 * guía o factura (la foto de la recepción se sube aparte). Body: `{ bookingId, pallets?, kg?,
 * odNumber?, guideNumber? }`. Solo en trabajos suyos.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Solicitud inválida' }, { status: 400 })
  const target = await resolveWorkerUploadTarget(body.bookingId)
  if (!target.ok) return NextResponse.json({ error: target.error }, { status: target.status })
  const { urgent: _ignored, ...fields } = body
  try {
    const result = await setDeliveryData(target.bookingId, fields, { admin: false })
    if (Object.keys(result.changes).length > 0) {
      await logAdminAction({
        actor: { username: target.label },
        action: 'booking.delivery_changed',
        entityType: 'booking',
        entityId: String(target.bookingId),
        entityLabel: result.label,
        summary: `${target.label} anotó la entrega de ${result.label}`,
        changes: result.changes,
        request,
      })
    }
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof CompanyClosingError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('[trabajos/entrega] Error:', error)
    return NextResponse.json({ error: 'No pudimos guardar la entrega. Intenta de nuevo.' }, { status: 500 })
  }
}
