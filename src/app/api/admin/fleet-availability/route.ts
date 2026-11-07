import { NextRequest, NextResponse } from 'next/server'
import { getVehicleAvailability } from '@/lib/vehicleAvailability'

export const dynamic = 'force-dynamic'

/**
 * Qué camiones pueden tomar un trabajo en una fecha/hora/duración, y cuál elegiría el
 * reparto automático. Solo para el panel: vive bajo /api/admin y no está entre las
 * lecturas públicas del middleware, así que exige sesión.
 *
 * La disponibilidad que ve el cliente en la web NO sale de acá: sigue siendo
 * /api/bookings/available, que cuenta cupos por horario sobre toda la flota.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const date = params.get('date') || ''
  const time = params.get('time') || ''
  const duration = Number(params.get('duration'))

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{1,2}:\d{2}/.test(time)) {
    return NextResponse.json({ error: 'Fecha u hora inválida' }, { status: 400 })
  }

  try {
    const availability = await getVehicleAvailability({
      scheduled_date: date,
      scheduled_time: time,
      duration_hours: Number.isFinite(duration) && duration > 0 ? duration : null,
      excludeBookingId: params.get('excludeId'),
    })
    return NextResponse.json(availability)
  } catch (error) {
    console.error('[fleet-availability] Error:', error)
    return NextResponse.json({ error: 'No se pudo calcular la disponibilidad' }, { status: 500 })
  }
}
