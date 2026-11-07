import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import {
  buildUnifiedCustomers,
  groupBookingsByMonth,
  groupCustomersBySource,
  buildFunnel,
} from '@/lib/adminAnalytics'
import { mergeBookingQuoteDetails } from '@/lib/adminBookingQuoteData'

// Datos en vivo: no cachear en build.
export const dynamic = 'force-dynamic'

const MONTHS_BACK = 6

export async function GET() {
  try {
    const [bookingsRes, prospectsRes] = await Promise.all([
      supabaseAdmin
        .from('bookings')
        .select(
          'id, quote_id, client_email, client_name, client_phone, is_company, company_name, company_rut, scheduled_date, scheduled_time, status, total_price, original_price, adjusted_price, amount_paid, payment_status, payment_type'
        ),
      supabaseAdmin
        .from('quote_prospects')
        .select(
          'id, quote_id, email, name, phone, source, status, is_frequent, is_company, company_name, company_rut, notes, scheduled_date, scheduled_time, converted_booking_id, lead_key, created_at'
        )
        .order('created_at', { ascending: false }),
    ])

    if (bookingsRes.error) {
      console.error('[analytics] bookings error:', bookingsRes.error)
    }
    if (prospectsRes.error) {
      console.error('[analytics] prospects error:', prospectsRes.error)
    }

    const bookings = bookingsRes.data || []
    const allProspects = prospectsRes.data || []
    const prospects = allProspects.filter((prospect) => {
      const key = String(prospect.lead_key || '')
      return !key.startsWith('manual_customer:') && !key.startsWith('admin_booking:')
    })
    const enrichedBookings = mergeBookingQuoteDetails(bookings, allProspects)
    const customers = buildUnifiedCustomers(enrichedBookings, allProspects)

    return NextResponse.json({
      monthly: groupBookingsByMonth(bookings, MONTHS_BACK),
      sources: groupCustomersBySource(customers),
      funnel: buildFunnel(prospects, bookings),
    })
  } catch (error) {
    console.error('Error in /api/admin/analytics:', error)
    return NextResponse.json({ error: 'Error obteniendo analítica' }, { status: 500 })
  }
}
