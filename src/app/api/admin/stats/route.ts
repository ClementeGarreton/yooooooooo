import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getActiveCapacity } from '@/lib/fleetCapacity'
import {
  summarizeBookings,
  summarizeBookingsByOrigin,
  summarizeOutstandingQuotes,
} from '@/lib/revenueBreakdown'
import { mergeBookingQuoteDetails } from '@/lib/adminBookingQuoteData'
import { getAdminAccess } from '@/lib/adminPermissions'
import { canSeeModule } from '@/lib/adminAccess'

// Lee datos en vivo: no debe prerenderizarse/cachearse en build.
export const dynamic = 'force-dynamic'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
/** Tope del rango a medida: más que esto es un reporte, no el resumen de Inicio. */
const MAX_RANGE_DAYS = 366

/** Días entre dos fechas 'YYYY-MM-DD', contando las dos puntas. */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1
}

/**
 * Resumen de Inicio. Los ingresos y la ocupación son del PERÍODO pedido con
 * `?desde=YYYY-MM-DD&hasta=YYYY-MM-DD` (por fecha del servicio); sin parámetros, o con un
 * rango inválido, es el mes en curso, como siempre. «Reservas hoy», «Pendientes» y las
 * cotizaciones vigentes no dependen del período.
 *
 * Los MONTOS (ingresos, ticket, cotizado vigente) solo se entregan a quien tiene el módulo
 * Finanzas. Inicio usa los conteos y la ocupación, que van para todos.
 */
export async function GET(request: NextRequest) {
  try {
    console.log('[API] Fetching admin stats...')
    
    // Obtener estadísticas del dashboard
    const today = new Date().toISOString().split('T')[0]
    let startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0]
    let endOfMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).toISOString().split('T')[0]

    const desde = request.nextUrl.searchParams.get('desde') || ''
    const hasta = request.nextUrl.searchParams.get('hasta') || ''
    const customRange =
      DATE_RE.test(desde) &&
      DATE_RE.test(hasta) &&
      !Number.isNaN(Date.parse(desde)) &&
      !Number.isNaN(Date.parse(hasta)) &&
      desde <= hasta &&
      daysBetween(desde, hasta) <= MAX_RANGE_DAYS
    if (customRange) {
      startOfMonth = desde
      endOfMonth = hasta
    }

    const todayChile = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Santiago',
    }).format(new Date())

    // Las siete lecturas no dependen una de otra: van en paralelo. Una detrás de otra
    // sumaban ~0,9 s de pura espera de red (medido el 24-sep-2026) para un resumen de 1 KB.
    const [
      { count: todayBookings, error: todayError },
      { count: pendingBookings, error: pendingError },
      { data: fleetConfig, error: fleetError },
      // 4. Ingresos del mes, separados en COBRADO y POR COBRAR.
      //    Ojo: no se suma total_price directamente porque cambió de significado en
      //    julio-2026 (ver comentario en revenueBreakdown.ts). `amount_paid` manda; la
      //    modalidad de pago queda como respaldo para registros históricos.
      { data: monthlyBookings, error: monthlyError },
      { data: originProspects, error: originError },
      // 4b. Cotizaciones vigentes sin reserva: la mudanza todavía no ocurrió y el lead
      //     sigue abierto. Es plata que aún se puede cerrar.
      { data: openProspects },
      // 5. Franjas horarias configuradas, para la ocupación del mes.
      { data: scheduleConfig },
    ] = await Promise.all([
      // 1. Reservas de hoy
      supabaseAdmin
        .from('bookings')
        .select('id', { count: 'exact', head: true })
        .eq('scheduled_date', today)
        .in('status', ['confirmed', 'pending']),
      // 2. Reservas pendientes
      supabaseAdmin
        .from('bookings')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending'),
      // 3. Configuración de flota
      supabaseAdmin.from('fleet_config').select('*').single(),
      supabaseAdmin
        .from('bookings')
        .select(
          'id, quote_id, client_name, client_email, client_phone, scheduled_date, scheduled_time, original_price, total_price, adjusted_price, amount_paid, payment_type, payment_status, status, is_provisional, flow_token, payment_method'
        )
        .gte('scheduled_date', startOfMonth)
        .lte('scheduled_date', endOfMonth)
        .neq('status', 'cancelled'),
      supabaseAdmin
        .from('quote_prospects')
        .select(
          'quote_id, email, source, scheduled_date, scheduled_time, converted_booking_id, lead_key, created_at'
        )
        .eq('status', 'converted'),
      supabaseAdmin
        .from('quote_prospects')
        .select('status, total_price, adjusted_price, scheduled_date, converted_booking_id')
        .gte('scheduled_date', todayChile),
      supabaseAdmin.from('schedule_config').select('time_slots').single(),
    ])

    if (todayError) console.error('[API] Error fetching today bookings:', todayError)
    if (pendingError) console.error('[API] Error fetching pending bookings:', pendingError)
    if (fleetError) console.error('[API] Error fetching fleet config:', fleetError)
    if (monthlyError) console.error('[API] Error fetching monthly bookings:', monthlyError)
    if (originError) console.error('[API] Error fetching customer origins:', originError)

    const monthlyWithOrigin = mergeBookingQuoteDetails(
      monthlyBookings || [],
      originProspects || []
    )
    const revenue = summarizeBookings(monthlyWithOrigin)
    const revenueByOrigin = summarizeBookingsByOrigin(monthlyWithOrigin)
    // Se mantiene `monthlyRevenue` por compatibilidad: ahora es la plata realmente
    // recibida, no el valor nominal de las reservas.
    const monthlyRevenue = revenue.paid

    const quotes = summarizeOutstandingQuotes(openProspects || [], todayChile)

    // 5. Ocupación del mes = reservas del mes / cupos reales.
    //    Cupos = vehículos ACTIVOS * franjas horarias configuradas * días del mes
    //    (antes era un 6*30 hardcodeado que ignoraba flota y horarios reales).
    const slotsPerDay = Array.isArray(scheduleConfig?.time_slots)
      ? scheduleConfig!.time_slots.length
      : 6
    const activeVehicles = getActiveCapacity(fleetConfig)
    // Días del período: los del mes, o los del rango pedido.
    const daysInMonth = daysBetween(startOfMonth, endOfMonth)

    const totalSlots = Math.max(1, activeVehicles * slotsPerDay * daysInMonth)
    const occupiedSlots = monthlyBookings?.length || 0
    const occupancyRate = Math.min(100, Math.round((occupiedSlots / totalSlots) * 100))

    // 6. Ticket promedio
    // Ticket promedio sobre el valor de lo reservado (no sobre lo ya cobrado).
    const averageTicket = occupiedSlots > 0 ? Math.round(revenue.booked / occupiedSlots) : 0

    const seesMoney = canSeeModule(await getAdminAccess(request), 'finance')

    const counts = {
      // Período que resumen los ingresos y la ocupación.
      period: { from: startOfMonth, to: endOfMonth },
      todayBookings: todayBookings || 0,
      pendingBookings: pendingBookings || 0,
      totalVehicles: fleetConfig?.num_vehicles,
      occupancyRate,
    }
    if (!seesMoney) return NextResponse.json(counts)

    const stats = {
      ...counts,
      monthlyRevenue,
      averageTicket,
      // Desglose de ingresos del mes
      revenue: {
        paid: revenue.paid,
        paidCount: revenue.paidCount,
        paidByChannel: revenue.paidByChannel,
        pending: revenue.pending,
        pendingCount: revenue.pendingCount,
        booked: revenue.booked,
        byOrigin: revenueByOrigin,
      },
      outstandingQuotes: {
        total: quotes.total,
        count: quotes.count,
      },
    }

    return NextResponse.json(stats)
  } catch (error) {
    console.error('[API] Exception in /api/admin/stats:', error)
    return NextResponse.json(
      { error: 'Error obteniendo estadísticas', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
