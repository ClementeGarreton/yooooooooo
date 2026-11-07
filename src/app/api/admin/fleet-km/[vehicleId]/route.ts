import { NextRequest, NextResponse } from 'next/server'
import { getActorFromRequest, logAdminAction } from '@/lib/activityLog'
import { FleetKmError, saveVehicleDetails } from '@/lib/fleetKm'

export const dynamic = 'force-dynamic'

/** Guarda patente, marca o una lectura nueva de kilometraje de un camión. */
export async function PUT(request: NextRequest, { params }: { params: { vehicleId: string } }) {
  try {
    const actor = getActorFromRequest(request)
    const result = await saveVehicleDetails(params.vehicleId, await request.json().catch(() => ({})), actor?.username || 'administrador')
    const changes: Record<string, { from: unknown; to: unknown }> = {}
    for (const key of ['plate', 'brand', 'odometer_km'] as const) {
      const from = (result.before as any)?.[key] ?? null
      const to = (result.after as any)[key] ?? null
      if (from !== to) changes[key] = { from, to }
    }
    if (Object.keys(changes).length > 0) {
      await logAdminAction({
        actor,
        action: 'fleet.vehicle_details_updated',
        entityType: 'fleet',
        entityId: params.vehicleId,
        entityLabel: result.vehicleName,
        summary: `Actualizó la ficha de ${result.vehicleName}${'odometer_km' in changes ? ` (kilometraje: ${changes.odometer_km.to})` : ''}`,
        changes,
        request,
      })
    }
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof FleetKmError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('[admin/fleet-km] Error guardando:', error)
    return NextResponse.json({ error: 'No se pudo guardar la ficha del camión' }, { status: 500 })
  }
}
