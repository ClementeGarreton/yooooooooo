import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { fetchGoogleCalendarEvents, isGoogleCalendarConfigured } from '@/lib/googleCalendarFeed'
import { getFleetVehicleViews, getVehicleAssignmentsInRange } from '@/lib/vehicleAssignment'

// Datos en vivo: no cachear en build.
export const dynamic = 'force-dynamic'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
// La vista de mes pide ~42 días; el tope evita que alguien pida un año entero de
// Google Calendar de una sola vez (cada llamada son 2 requests a la API de Google).
const MAX_DIAS = 120

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function diffDays(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`)
  const b = Date.parse(`${to}T00:00:00Z`)
  return Math.round((b - a) / 86400000)
}

/**
 * Datos del calendario del panel admin para un rango de días: las reservas del
 * cotizador (Supabase) + los eventos de los dos Google Calendar de Tomás (vía n8n).
 *
 * El rango que se le pide a Google va con un día de colchón a cada lado a propósito:
 * el rango que manda el navegador son fechas de pared chilenas y Chile alterna entre
 * UTC-3 y UTC-4, así que convertir con un offset fijo se comería eventos de borde en
 * los cambios de horario. Con el colchón sobran eventos, nunca faltan, y el cliente
 * los reparte por su fecha real en America/Santiago.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const from = searchParams.get('from') || ''
    const to = searchParams.get('to') || ''

    if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
      return NextResponse.json(
        { error: 'Parámetros "from" y "to" requeridos con formato YYYY-MM-DD' },
        { status: 400 }
      )
    }

    const span = diffDays(from, to)
    if (span < 0 || span > MAX_DIAS) {
      return NextResponse.json(
        { error: `El rango debe ir de menor a mayor y no superar ${MAX_DIAS} días` },
        { status: 400 }
      )
    }

    const bookingsPromise = supabaseAdmin
      .from('bookings')
      .select(
        `
        id,
        quote_id,
        client_name,
        client_phone,
        client_email,
        scheduled_date,
        scheduled_time,
        duration_hours,
        status,
        booking_type,
        is_provisional,
        payment_status,
        total_price,
        original_price,
        adjusted_price,
        origin_address,
        destination_address,
        visit_address
      `
      )
      .gte('scheduled_date', from)
      .lte('scheduled_date', to)
      .not('status', 'in', '(cancelled,no_show)')
      .order('scheduled_date', { ascending: true })
      .order('scheduled_time', { ascending: true })

    const googlePromise = fetchGoogleCalendarEvents(
      `${addDays(from, -1)}T00:00:00.000Z`,
      `${addDays(to, 1)}T23:59:59.999Z`
    )

    const [bookingsRes, google, vehicles, assignments] = await Promise.all([
      bookingsPromise,
      googlePromise,
      getFleetVehicleViews(),
      getVehicleAssignmentsInRange(from, to),
    ])

    if (bookingsRes.error) {
      console.error('[calendar] error leyendo reservas:', bookingsRes.error)
      return NextResponse.json(
        { error: 'Error obteniendo reservas', details: bookingsRes.error.message },
        { status: 500 }
      )
    }

    // Solo se LEEN las asignaciones existentes: el reparto automático de camiones lo
    // dispara el dashboard (ensureVehicleAssignments). Abrir un mes del calendario no
    // debería escribir vehicle_id en decenas de reservas de golpe.
    const bookings = (bookingsRes.data || []).map((b) => {
      const vehicle = vehicles.find((v) => v.id === assignments.get(b.id))
      return {
        ...b,
        estimated_price: b.adjusted_price ?? b.original_price ?? b.total_price ?? null,
        vehicle: vehicle
          ? { id: vehicle.id, name: vehicle.name, driver: vehicle.driver, color: vehicle.color }
          : null,
      }
    })

    return NextResponse.json({
      range: { from, to },
      bookings,
      google: {
        configured: isGoogleCalendarConfigured(),
        connected: google.connected,
        error: google.error ?? null,
        events: google.events,
      },
    })
  } catch (error) {
    console.error('[calendar] excepción en /api/admin/calendar:', error)
    return NextResponse.json(
      {
        error: 'Error obteniendo el calendario',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
