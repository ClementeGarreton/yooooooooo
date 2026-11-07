import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { JobError, setBookingCrew } from '@/lib/adminJobs'
import { UUID_RE, WORKER_FIELDS, getAssignedWorkerIds, onlyFieldWorkers } from '@/lib/workers'

export const dynamic = 'force-dynamic'

/** Cuadrilla de una reserva: los trabajadores activos y cuáles están asignados. */
export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  if (!UUID_RE.test(params.id)) return NextResponse.json({ error: 'Reserva no encontrada' }, { status: 404 })
  const [{ data: workers, error }, assigned] = await Promise.all([
    supabaseAdmin.from('workers').select(WORKER_FIELDS).order('name'),
    getAssignedWorkerIds(params.id),
  ])
  if (error) {
    console.error('[admin/bookings/workers] Error:', error)
    return NextResponse.json({ error: 'No se pudo cargar la cuadrilla' }, { status: 500 })
  }
  // Los desactivados solo se muestran si quedaron asignados, para poder sacarlos. Administrativos,
  // contador y externos no van a terreno: tampoco aparecen.
  return NextResponse.json({
    workers: await onlyFieldWorkers((workers || []).filter((w) => w.active || assigned.includes(w.id)), assigned),
    assigned,
  })
}

/** Deja la cuadrilla de la reserva exactamente en `workerIds`. Body: `{ workerIds: string[] }`. */
export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  const body = await request.json().catch(() => ({}))
  try {
    return NextResponse.json({ ok: true, assigned: await setBookingCrew(request, params.id, body?.workerIds) })
  } catch (error) {
    if (error instanceof JobError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('[admin/bookings/workers] Error:', error)
    return NextResponse.json({ error: 'No se pudo guardar la cuadrilla' }, { status: 500 })
  }
}
