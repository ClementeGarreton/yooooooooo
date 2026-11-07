import { NextRequest, NextResponse } from 'next/server'
import { JobError, setBookingCrew, setBookingFixedTime, setBookingVehicle } from '@/lib/adminJobs'

export const dynamic = 'force-dynamic'

/**
 * Asignación de un trabajo. Body: `{ vehicleId?: number | null, workerIds?: string[], fixedTime?: boolean }`;
 * se aplica lo que venga. Deja registro en Actividad y avisa a los trabajadores.
 */
export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  const body = await request.json().catch(() => ({}))
  try {
    const result: { vehicleId?: number | null; crew?: string[]; fixedTime?: boolean } = {}
    if (body?.vehicleId !== undefined) result.vehicleId = await setBookingVehicle(request, params.id, body.vehicleId)
    if (body?.workerIds !== undefined) result.crew = await setBookingCrew(request, params.id, body.workerIds)
    if (body?.fixedTime !== undefined) result.fixedTime = await setBookingFixedTime(request, params.id, body.fixedTime)
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    if (error instanceof JobError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('[admin/jobs] Error asignando:', error)
    return NextResponse.json({ error: 'No se pudo guardar la asignación' }, { status: 500 })
  }
}
