import { NextRequest, NextResponse } from 'next/server'
import { getActorFromRequest, logAdminAction } from '@/lib/activityLog'
import { ServiceRequestError, rejectRequest } from '@/lib/serviceRequests'

export const dynamic = 'force-dynamic'

/** Rechaza una solicitud pendiente. Body: `{ reason }` (el cliente lo lee en su panel). */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await request.json().catch(() => ({}))
    const actor = getActorFromRequest(request)
    const rejected = await rejectRequest(params.id, String(body?.reason || ''), actor?.username || null)
    await logAdminAction({
      actor,
      action: 'service_request.rejected',
      entityType: 'service_request',
      entityId: rejected.id,
      entityLabel: rejected.code,
      summary: `Rechazó la solicitud ${rejected.code}`,
      changes: { status: { from: 'pendiente', to: 'rechazada' }, motivo: { from: null, to: String(body?.reason || '').trim().slice(0, 500) } },
      request,
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof ServiceRequestError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('[admin/service-requests/reject] Error:', error)
    return NextResponse.json({ error: 'No se pudo rechazar la solicitud' }, { status: 500 })
  }
}
