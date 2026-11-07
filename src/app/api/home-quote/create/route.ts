import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { resolveBookingAttribution } from '@/lib/attributionServer'
import { getActiveCapacity } from '@/lib/fleetCapacity'

function chileDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santiago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    const {
      quote_id,
      client_name,
      client_email,
      client_phone,
      booking_type = 'domicilio',
      visit_address,
      total_price,
      original_price,
      scheduled_date,
      scheduled_time,
      duration_hours = 1,
    } = body

    // Validar datos requeridos
    if (
      !quote_id ||
      !client_name ||
      !client_email ||
      !client_phone ||
      !visit_address ||
      !total_price ||
      !scheduled_date ||
      !scheduled_time
    ) {
      return NextResponse.json({ error: 'Datos incompletos' }, { status: 400 })
    }

    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(String(scheduled_date)) ||
      !/^\d{2}:\d{2}(?::\d{2})?$/.test(String(scheduled_time))
    ) {
      return NextResponse.json({ error: 'Fecha u hora inválida' }, { status: 400 })
    }

    if (String(scheduled_date) <= chileDate()) {
      return NextResponse.json(
        { error: 'La visita debe reservarse desde mañana' },
        { status: 400 }
      )
    }

    // Volver a comprobar el cupo al guardar evita tomar un horario que otra persona
    // acaba de reservar después de que el cliente abrió el selector.
    const [{ data: configData, error: configError }, { count: bookingCount }, { data: blockedData }] =
      await Promise.all([
        supabaseAdmin.from('fleet_config').select('*').single(),
        supabaseAdmin
          .from('bookings')
          .select('id', { count: 'exact', head: true })
          .eq('scheduled_date', scheduled_date)
          .eq('scheduled_time', scheduled_time)
          .in('status', ['confirmed', 'pending']),
        supabaseAdmin
          .from('blocked_slots')
          .select('id')
          .eq('date', scheduled_date)
          .lte('start_time', scheduled_time)
          .gt('end_time', scheduled_time),
      ])

    if (configError || !configData) {
      return NextResponse.json(
        { error: 'No pudimos comprobar la disponibilidad del horario' },
        { status: 500 }
      )
    }

    const capacity = getActiveCapacity(configData)
    const activeBookings = bookingCount || 0
    const isBlocked = !!blockedData?.length
    if (activeBookings >= capacity || isBlocked) {
      return NextResponse.json(
        { error: 'Ese horario acaba de quedar sin disponibilidad. Elige otro horario.' },
        { status: 409 }
      )
    }

    // Atribucion de Google Ads: la del cliente o, si no trae, la heredada del prospecto
    // con el mismo quote_id.
    const attribution = await resolveBookingAttribution(body, quote_id)

    // Crear la reserva de tipo domicilio
    const { data: booking, error: createError } = await supabaseAdmin
      .from('bookings')
      .insert({
        quote_id,
        client_name,
        client_email: String(client_email).trim().toLowerCase(),
        client_phone,
        booking_type,
        visit_address,
        total_price,
        original_price: original_price || total_price,
        status: 'pending',
        payment_status: 'pending',
        scheduled_date,
        scheduled_time,
        duration_hours: duration_hours || 1,
        ...attribution,
      })
      .select()
      .single()

    if (createError) {
      console.error('Error creating home quote booking:', createError)
      return NextResponse.json(
        { error: 'Error al crear la reserva de cotización a domicilio' },
        { status: 500 }
      )
    }

    return NextResponse.json(
      {
        success: true,
        booking,
        message: 'Reserva de cotización a domicilio creada exitosamente',
      },
      { status: 201 }
    )
  } catch (error) {
    console.error('Error in /api/home-quote/create:', error)
    return NextResponse.json(
      { error: 'Error al crear la reserva de cotización a domicilio' },
      { status: 500 }
    )
  }
}
