import { NextRequest, NextResponse } from 'next/server'
import { getActorFromRequest, logAdminAction } from '@/lib/activityLog'
import { ModificationError, describeChange, resolveModification } from '@/lib/bookingModifications'

export const dynamic = 'force-dynamic'

/**
 * Resuelve una modificación en terreno. Body: `{ action: 'approve' | 'reject', priceDelta?, note? }`.
 * Al aprobar, `priceDelta` es el ajuste que fija quien aprueba (0 = sin cambio de precio).
 * Queda en Actividad a nombre de la reserva, para que salga en su historial.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await request.json().catch(() => ({}))
    const action = body?.action === 'reject' ? 'reject' : 'approve'
    const actor = getActorFromRequest(request)
    const { modification, priceChanged } = await resolveModification(
      params.id,
      { action, priceDelta: body?.priceDelta, note: body?.note },
      actor?.username || 'administrador'
    )

    const change = describeChange(modification)
    const fmt = (n: number | null) => `$${Math.round(n || 0).toLocaleString('es-CL')}`
    await logAdminAction({
      actor,
      action: action === 'approve' ? 'booking.modification_approved' : 'booking.modification_rejected',
      entityType: 'booking',
      entityId: modification.bookingId,
      entityLabel: modification.booking?.code || modification.booking?.clientName || modification.bookingId,
      summary:
        action === 'approve'
          ? `Aprobó la modificación en terreno (${change}) de ${modification.workerLabel}${
              priceChanged ? `: ${fmt(modification.priceBefore)} → ${fmt(modification.priceAfter)}` : ', sin cambio de precio'
            }`
          : `Rechazó la modificación en terreno (${change}) de ${modification.workerLabel}`,
      changes: priceChanged ? { adjusted_price: { from: modification.priceBefore, to: modification.priceAfter } } : undefined,
      request,
    })
    return NextResponse.json({ ok: true, modification })
  } catch (error) {
    if (error instanceof ModificationError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('[admin/modifications/resolve] Error:', error)
    return NextResponse.json({ error: 'No se pudo resolver la modificación' }, { status: 500 })
  }
}
