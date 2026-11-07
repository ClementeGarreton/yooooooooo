import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { buildUnifiedCustomers } from '@/lib/adminAnalytics'
import { mergeBookingQuoteDetails } from '@/lib/adminBookingQuoteData'

// Cartera unificada: clientes atendidos derivados de reservas + fichas creadas
// manualmente sin reserva. La identidad se consolida por email.
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const [bookingsResult, prospectsResult] = await Promise.all([
      supabaseAdmin
        .from('bookings')
        .select(
          'id, quote_id, client_email, client_name, client_phone, is_company, company_name, company_rut, scheduled_date, scheduled_time, status, total_price, original_price, adjusted_price, amount_paid, payment_status, payment_type'
        )
        .neq('status', 'cancelled')
        .or('status.eq.completed,and(payment_status.eq.approved,payment_type.eq.completo)'),
      supabaseAdmin
        .from('quote_prospects')
        .select(
          'id, quote_id, email, name, phone, source, status, is_frequent, is_company, company_name, company_rut, notes, scheduled_date, scheduled_time, converted_booking_id, lead_key, created_at'
        )
        .order('created_at', { ascending: false }),
    ])

    if (bookingsResult.error) {
      console.error('[customers/attended] bookings error:', bookingsResult.error)
      return NextResponse.json({ error: 'Error obteniendo clientes atendidos' }, { status: 500 })
    }
    if (prospectsResult.error) {
      console.error('[customers/attended] prospects error:', prospectsResult.error)
      return NextResponse.json({ error: 'Error obteniendo fichas de clientes' }, { status: 500 })
    }

    const prospects = prospectsResult.data || []
    const enrichedBookings = mergeBookingQuoteDetails(bookingsResult.data || [], prospects)
    const customers = buildUnifiedCustomers(enrichedBookings, prospects)

    // Orden alfabético por nombre (pedido de Tomás, 23-sep-2026): esta lista se usa para
    // BUSCAR a una persona —en la pestaña Clientes y en el selector de Nueva Reserva—, y
    // por antigüedad no se encuentra a nadie. `localeCompare` en español para que las
    // tildes y las mayúsculas no manden a «Ángela» al final; quien no tiene nombre
    // cargado se ordena por su correo.
    customers.sort((a, b) =>
      String(a.name || a.email || '').localeCompare(String(b.name || b.email || ''), 'es', {
        sensitivity: 'base',
        numeric: true,
      })
    )

    // Sin el total gastado: el panel de Clientes no muestra montos (Francisco, 20-10-2026) y
    // así tampoco viajan al navegador. Se sigue usando adentro para ordenar y consolidar.
    return NextResponse.json(customers.map(({ totalSpent: _spent, ...customer }) => customer))
  } catch (error) {
    console.error('Error in /api/admin/customers/attended:', error)
    return NextResponse.json({ error: 'Error obteniendo clientes' }, { status: 500 })
  }
}
