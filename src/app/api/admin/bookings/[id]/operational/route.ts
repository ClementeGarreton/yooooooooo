import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getActorFromRequest, logAdminAction } from '@/lib/activityLog'
import { getVehicleAvailability } from '@/lib/vehicleAvailability'
import { OperationalError, parseOperationalOverrides, readOperationalOverrides, saveOperationalOverrides } from '@/lib/bookingOperational'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Lo operacional de una reserva que no viene en la lista de Reservas, para el resumen del
 * detalle:
 *  - `peopleOverride`, `volumeOverride`, `distanceOverride`: lo puesto a mano en la reserva
 *    (ver bookingOperational.ts; los `*Available` dicen si está corrida cada migración).
 *  - `team`: quiénes van — los de la cuadrilla y los que tienen ese camión como habitual.
 *  - `vehicles`: cada camión para ESA fecha, hora y duración, con sus choques. Es la misma
 *    función que usa «Nueva reserva», así que el detalle y el alta opinan lo mismo.
 */
export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  if (!UUID_RE.test(params.id)) return NextResponse.json({ error: 'Reserva no encontrada' }, { status: 404 })
  const { data: booking } = await supabaseAdmin.from('bookings').select('*').eq('id', params.id).maybeSingle()
  if (!booking) return NextResponse.json({ error: 'Reserva no encontrada' }, { status: 404 })

  const [{ data: workers }, { data: crew }] = await Promise.all([
    supabaseAdmin.from('workers').select('id, name, phone, vehicle_id, active').order('name'),
    supabaseAdmin.from('booking_workers').select('worker_id').eq('booking_id', booking.id),
  ])
  const crewIds = new Set((crew || []).map((r) => r.worker_id))
  const team = (workers || [])
    .filter((w) => crewIds.has(w.id) || (w.active && typeof booking.vehicle_id === 'number' && w.vehicle_id === booking.vehicle_id))
    .map((w) => ({ id: w.id, name: w.name, phone: w.phone, via: crewIds.has(w.id) ? ('cuadrilla' as const) : ('camion' as const) }))

  let vehicles: unknown[] = []
  let recommendedVehicleId: number | null = null
  const live = !['cancelled', 'no_show'].includes(String(booking.status || ''))
  if (live && booking.scheduled_date && /^\d{1,2}:\d{2}/.test(String(booking.scheduled_time || ''))) {
    try {
      const availability = await getVehicleAvailability({
        scheduled_date: booking.scheduled_date,
        scheduled_time: String(booking.scheduled_time),
        duration_hours: Number(booking.duration_hours) > 0 ? Number(booking.duration_hours) : null,
        excludeBookingId: booking.id,
      })
      vehicles = availability.vehicles
      recommendedVehicleId = availability.recommendedVehicleId
    } catch (error) {
      console.error('[admin/bookings/operational] Disponibilidad:', error)
    }
  }

  return NextResponse.json({
    ...readOperationalOverrides(booking),
    vehicleId: typeof booking.vehicle_id === 'number' ? booking.vehicle_id : null,
    team,
    vehicles,
    recommendedVehicleId,
  })
}

/**
 * Datos puestos a mano. Body: cualquiera de `{ peopleNeeded, volumeM3, distanceKm }`; `null`
 * vuelve a lo que diga la cotización.
 */
export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  if (!UUID_RE.test(params.id)) return NextResponse.json({ error: 'Reserva no encontrada' }, { status: 404 })
  let overrides
  try {
    overrides = parseOperationalOverrides(await request.json().catch(() => ({})))
  } catch (error) {
    if (error instanceof OperationalError) return NextResponse.json({ error: error.message }, { status: error.status })
    throw error
  }
  if (Object.keys(overrides).length === 0) return NextResponse.json({ error: 'Nada que cambiar' }, { status: 400 })

  const { data: before } = await supabaseAdmin.from('bookings').select('*').eq('id', params.id).maybeSingle()
  if (!before) return NextResponse.json({ error: 'Reserva no encontrada' }, { status: 404 })

  const failed = await saveOperationalOverrides(params.id, overrides)
  if (failed.length === Object.keys(overrides).length) {
    return NextResponse.json({ error: `No se pudo guardar: ${failed.join(', ')}.` }, { status: 409 })
  }
  const { data: after } = await supabaseAdmin.from('bookings').select('*').eq('id', params.id).maybeSingle()
  const now = readOperationalOverrides(after || before)
  const was = readOperationalOverrides(before)
  await logAdminAction({
    actor: getActorFromRequest(request),
    action: 'booking.operational_changed',
    entityType: 'booking',
    entityId: params.id,
    entityLabel: [before.client_name, before.scheduled_date].filter(Boolean).join(' · ') || 'Reserva',
    summary: 'Cambió datos operacionales de la reserva (personas, volumen o distancia)',
    changes: {
      personas: { from: was.peopleOverride, to: now.peopleOverride },
      volumen_m3: { from: was.volumeOverride, to: now.volumeOverride },
      distancia_km: { from: was.distanceOverride, to: now.distanceOverride },
    },
    request,
  })
  return NextResponse.json({ ok: true, ...now, warning: failed.length ? `No se guardó: ${failed.join(', ')}.` : null })
}
