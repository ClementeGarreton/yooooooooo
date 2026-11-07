import { OperationalError, parseOperationalOverrides, saveOperationalOverrides, type OperationalOverrides } from '@/lib/bookingOperational'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { mergeBookingQuoteDetails, type AdminBookingQuoteSource } from '@/lib/adminBookingQuoteData'
import { getDriverNotesFor } from '@/lib/driverNotes'
import { getActiveCapacity } from '@/lib/fleetCapacity'
import { approveRequestWithBooking } from '@/lib/serviceRequests'
import { getActorFromRequest, logAdminAction } from '@/lib/activityLog'
import { normalizeOrigin } from '@/lib/prospectSource'
import { sendBookingConfirmedIfEligible } from '@/lib/transactionalEmails'
import { getVehicleAvailability } from '@/lib/vehicleAvailability'
import { isValidEmail } from '@/lib/emailFormat'
import { markBookingManual } from '@/lib/bookingOriginServer'
import { isMissingColumnError, normalizeTaxDocument } from '@/lib/taxDocument'
import { isPaymentLedgerAvailable, recordPayment } from '@/lib/bookingPayments'
import { mergePhotoUrls, quoteStatePhotos } from '@/lib/quoteState'
import {
  chileTodayString,
  ensureVehicleAssignments,
  getAllVehicleAssignments,
  getFleetVehicleViews,
  type AssignableBooking,
} from '@/lib/vehicleAssignment'

const PROSPECT_QUOTE_FIELDS = `
  id,
  quote_id,
  email,
  source,
  status,
  is_frequent,
  scheduled_date,
  scheduled_time,
  converted_booking_id,
  is_flexible,
  recommended_vehicle,
  total_volume,
  total_weight,
  total_distance,
  origin_floor,
  origin_has_elevator,
  origin_parking_distance,
  destination_floor,
  destination_has_elevator,
  destination_parking_distance,
  items_summary,
  additional_services,
  lead_key,
  created_at
`

/**
 * Fotos que el cliente subió al cotizar, para las reservas que quedaron sin ellas: hasta el
 * 27-10-2026 las reservas creadas desde el panel o sobre una pre-reserva anterior no las
 * copiaban, y solo vivían en la cotización (`quote_state`). Se leen de ahí sin tocar la base.
 */
async function quotePhotosFor(bookings: any[]): Promise<Map<string, string[]>> {
  const quoteIds = Array.from(
    new Set(
      bookings
        .filter((b) => b.quote_id && mergePhotoUrls(b.photo_urls, []).length === 0)
        .map((b) => String(b.quote_id))
    )
  )
  const chunks: string[][] = []
  for (let i = 0; i < quoteIds.length; i += 100) chunks.push(quoteIds.slice(i, i + 100))
  const results = await Promise.all(
    chunks.map((chunk) =>
      supabaseAdmin
        .from('quote_prospects')
        .select('quote_id, photos:quote_state->additionalServices->photos')
        .in('quote_id', chunk)
    )
  )
  const photosByQuote = new Map<string, string[]>()
  for (const { data, error } of results) {
    // Sin la columna quote_state (migración vieja) simplemente no hay fotos que sumar.
    if (error) continue
    for (const row of (data || []) as any[]) {
      const photos = quoteStatePhotos({ additionalServices: { photos: row.photos } })
      if (photos.length > 0 && !photosByQuote.has(row.quote_id)) photosByQuote.set(row.quote_id, photos)
    }
  }
  return photosByQuote
}

async function fetchProspectQuoteDetails(bookings: any[]) {
  if (bookings.length === 0) return []

  const bookingIds = [...new Set(bookings.map((b) => b.id).filter(Boolean))]
  const quoteIds = [...new Set(bookings.map((b) => b.quote_id).filter(Boolean))]
  const emails = [
    ...new Set(
      bookings
        .map((b) => (typeof b.client_email === 'string' ? b.client_email.toLowerCase().trim() : ''))
        .filter(Boolean)
    ),
  ]

  const queries = []

  if (bookingIds.length > 0) {
    queries.push(
      supabaseAdmin
        .from('quote_prospects')
        .select(PROSPECT_QUOTE_FIELDS)
        .in('converted_booking_id', bookingIds)
        .order('created_at', { ascending: false })
    )
  }

  if (quoteIds.length > 0) {
    queries.push(
      supabaseAdmin
        .from('quote_prospects')
        .select(PROSPECT_QUOTE_FIELDS)
        .in('quote_id', quoteIds)
        .order('created_at', { ascending: false })
    )
  }

  if (emails.length > 0) {
    queries.push(
      supabaseAdmin
        .from('quote_prospects')
        .select(PROSPECT_QUOTE_FIELDS)
        .in('email', emails)
        .order('created_at', { ascending: false })
    )
  }

  // Las fichas "Cliente antiguo" clasifican a la persona completa y pueden no
  // compartir quote_id/fecha con reservas históricas. Se traen como catálogo pequeño
  // y el merge las cruza por email normalizado.
  queries.push(
    supabaseAdmin
      .from('quote_prospects')
      .select(PROSPECT_QUOTE_FIELDS)
      .eq('source', 'cliente_antiguo')
      .order('created_at', { ascending: false })
  )

  const results = await Promise.all(queries)
  const byId = new Map<string, any>()

  results.forEach(({ data, error }) => {
    if (error) {
      console.error('[API] Error fetching booking quote details:', {
        error: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
      })
      return
    }

    const rows = data || []
    rows.forEach((row: any) => {
      if (row.id && !byId.has(row.id)) {
        byId.set(row.id, row)
      }
    })
  })

  return [...byId.values()]
}

export async function GET() {
  try {
    console.log('[API] Fetching bookings from database...')

    // Obtener todas las reservas con paginación
    // EXCLUIR reservas canceladas (pagos rechazados)
    //
    // `code` y `customer_id` los agrega add_public_ids.sql. La consulta se intenta CON
    // esas columnas y, si la migración todavía no está aplicada, se reintenta sin ellas
    // (ver más abajo): así desplegar antes o después de correr el SQL da lo mismo, y el
    // panel nunca se queda sin la lista de reservas por una columna que falta.
    // Columnas que agregan migraciones posteriores. Se piden todas y, si la base dice que
    // alguna no existe, se reintenta sin ese grupo — así desplegar antes de correr un SQL
    // no deja el panel sin la lista de reservas. Se prueban por separado para que faltar
    // una migración no haga desaparecer también las columnas de la otra.
    const selectColumns = (withPublicIds: boolean, withStops: boolean, withTaxDocument = false) => `
        id,
        ${withPublicIds ? 'code,\n        customer_id,' : ''}
        ${withStops ? 'stops,' : ''}
        ${withTaxDocument ? 'tax_document,' : ''}
        quote_id,
        client_name,
        client_email,
        client_phone,
        scheduled_date,
        scheduled_time,
        duration_hours,
        status,
        notes,
        payment_type,
        payment_status,
        is_provisional,
        total_price,
        original_price,
        adjusted_price,
        amount_paid,
        adjustment_comment,
        adjusted_at,
        adjusted_by,
        payment_method,
        origin_address,
        destination_address,
        origin_floor,
        origin_has_elevator,
        origin_parking_distance,
        destination_floor,
        destination_has_elevator,
        destination_parking_distance,
        is_company,
        company_name,
        company_rut,
        pdf_url,
        pdf_generated_at,
        photo_urls,
        booking_type,
        visit_address,
        service_completed_at,
        created_at,
        confirmed_at,
        completed_at,
        cancelled_at
      `

    const fetchBookings = (withPublicIds: boolean, withStops: boolean, withTaxDocument = false) =>
      supabaseAdmin
        .from('bookings')
        .select(selectColumns(withPublicIds, withStops, withTaxDocument))
        .neq('status', 'cancelled') // NO mostrar reservas canceladas (pagos rechazados)
        .order('created_at', { ascending: false }) // Más recientes primero

    // La flota y los camiones ya asignados no dependen de la lista de reservas: se piden
    // en paralelo con ella en vez de después (antes eran esperas en fila).
    const vehiclesPromise = getFleetVehicleViews()
    const assignmentsPromise = getAllVehicleAssignments()

    let { data: bookings, error } = await fetchBookings(true, true, true)

    // 42703 = undefined_column: falta alguna migración. Se sueltan de la más nueva a la
    // más vieja; la primera es add_booking_tax_document.sql (documento tributario).
    if (error?.code === '42703') {
      console.warn('[API] Falta alguna columna opcional. Reintentando sin documento tributario.')
      ;({ data: bookings, error } = await fetchBookings(true, true, false))
    }
    if (error?.code === '42703') {
      console.warn('[API] Falta alguna columna opcional. Reintentando sin paradas.')
      ;({ data: bookings, error } = await fetchBookings(true, false))
    }
    if (error?.code === '42703') {
      console.warn('[API] Reintentando también sin códigos públicos (¿falta add_public_ids.sql?).')
      ;({ data: bookings, error } = await fetchBookings(false, false))
    }

    if (error) {
      console.error('[API] Error fetching bookings:', {
        error: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
      })
      return NextResponse.json(
        { error: 'Error obteniendo reservas', details: error.message },
        { status: 500 }
      )
    }

    // El `select` se arma como string dinámico (con o sin códigos), así que Supabase ya
    // no puede inferir el tipo de las filas: se declara acá.
    const bookingRows = (bookings || []) as unknown as AdminBookingQuoteSource[]

    // Las tres cosas que faltan dependen solo de la lista, no una de otra: en paralelo.
    const [prospects, assignments, driverNotes, manualIds, quotePhotos] = await Promise.all([
      fetchProspectQuoteDetails(bookingRows),
      // Camión de cada reserva. Las futuras que aún no tienen uno se reparten acá y
      // quedan guardadas, así el admin y el link de choferes ven siempre lo mismo.
      Promise.all([vehiclesPromise, assignmentsPromise]).then(([vehicles, current]) =>
        ensureVehicleAssignments(bookingRows as AssignableBooking[], vehicles, current)
      ),
      // Notas que escribieron los choferes desde su link. Una sola consulta para todas
      // las reservas; si falta la migración devuelve vacío y el panel funciona igual.
      getDriverNotesFor(bookingRows.map((b) => b.id).filter((id): id is string => Boolean(id))),
      // Reservas ingresadas desde el panel (add_booking_origin.sql). Aparte de la lista para
      // que, sin la migración, falle solo esto y el panel siga igual.
      supabaseAdmin
        .from('bookings')
        .select('id')
        .eq('created_via', 'admin')
        .limit(20000)
        .then(({ data, error }) => new Set(error ? [] : (data || []).map((b: { id: string }) => b.id))),
      quotePhotosFor(bookingRows),
    ])
    const enrichedBookings = mergeBookingQuoteDetails(bookingRows, prospects)

    const withVehicle = enrichedBookings.map((b: any) => ({
      ...b,
      vehicle_id: assignments.get(b.id) ?? null,
      driver_notes: driverNotes.get(b.id) || [],
      created_via: manualIds.has(b.id) ? 'admin' : null,
      ...(b.quote_id && quotePhotos.has(b.quote_id) ? { photo_urls: quotePhotos.get(b.quote_id) } : {}),
    }))

    console.log(`[API] Successfully fetched ${withVehicle.length} bookings`)
    return NextResponse.json(withVehicle)
  } catch (error) {
    console.error('[API] Exception in /api/admin/bookings:', error)
    return NextResponse.json(
      {
        error: 'Error obteniendo reservas',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      quote_id,
      client_name,
      client_email,
      client_phone,
      scheduled_date,
      scheduled_time,
      duration_hours = 4,
      status = 'pending',
      payment_type,
      // Cómo se cobra: 'flow' (link de pago), 'transfer' (transferencia) o 'cash'
      // (efectivo). Para 'flow' el estado lo confirma después el webhook de Flow.
      payment_method,
      payment_status,
      total_price,
      original_price,
      amount_paid,
      origin_address,
      destination_address,
      notes,
      is_company = false,
      company_name,
      company_rut,
      customer_origin,
      skip_customer_record = false,
      override_capacity = false,
      // Camión: un id elige uno a mano; 'auto' (o nada) deja que decida el reparto.
      vehicle_id: vehicleChoice,
      // Documento tributario (boleta/factura/sin_documento). Vacío = sin definir.
      tax_document: taxDocumentInput,
      // Solicitud del panel del cliente que se está aprobando con esta reserva.
      service_request_id: serviceRequestId,
      // Acceso: piso y ascensor de cada punto (columnas que ya existían; antes solo se
      // podían cargar después, en Editar).
      origin_floor,
      origin_has_elevator,
      destination_floor,
      destination_has_elevator,
    } = body
    const capacityOverrideApproved = override_capacity === true

    if (!client_name || !client_email || !client_phone || !scheduled_date || !scheduled_time) {
      return NextResponse.json({ error: 'Datos incompletos' }, { status: 400 })
    }

    // El correo es la identidad del cliente (la ficha se arma por email) y el canal de los
    // avisos automáticos: un nombre en ese campo deja a la persona sin correos y crea una
    // ficha falsa. Los bloqueos de agenda no son clientes y usan su propio correo fijo.
    if (!skip_customer_record && !isValidEmail(client_email)) {
      return NextResponse.json(
        {
          error: `«${String(client_email).trim()}» no es un correo válido. Pídele el correo al cliente: con un nombre en ese campo no recibe ningún aviso.`,
          invalidEmail: true,
        },
        { status: 400 }
      )
    }

    const servicePrice = Math.round(Number(total_price || original_price || 0))
    const amountReceived = amount_paid !== undefined
      ? Math.max(0, Math.round(Number(amount_paid) || 0))
      : 0
    if (!skip_customer_record && payment_status === 'approved') {
      if (amount_paid === undefined || servicePrice <= 0 || amountReceived <= 0 || amountReceived > servicePrice) {
        return NextResponse.json(
          { error: 'Para marcar un pago aprobado, indica el precio del servicio y el monto efectivamente recibido (mayor que cero y no superior al precio).' },
          { status: 400 }
        )
      }
      if (!(await isPaymentLedgerAvailable())) {
        return NextResponse.json({ error: 'El libro de pagos no está disponible; no se creó la reserva con cobro.' }, { status: 503 })
      }
    }
    if (!skip_customer_record && payment_status !== 'approved' && amountReceived > 0) {
      return NextResponse.json({ error: 'Si ya se recibió dinero, registra el monto y marca el pago como aprobado.' }, { status: 400 })
    }

    // Obtener capacidad de flota (vehículos activos, no total)
    const { data: configData, error: configError } = await supabaseAdmin
      .from('fleet_config')
      .select('*')
      .single()

    if (configError || !configData) {
      return NextResponse.json(
        { error: 'Error obteniendo configuración de flota' },
        { status: 500 }
      )
    }

    const capacity = getActiveCapacity(configData)

    // Contar reservas activas para ese horario
    const { count: bookingCount } = await supabaseAdmin
      .from('bookings')
      .select('id', { count: 'exact', head: true })
      .eq('scheduled_date', scheduled_date)
      .eq('scheduled_time', scheduled_time)
      .in('status', ['confirmed', 'pending'])

    // Verificar bloqueos
    const { data: blockedData } = await supabaseAdmin
      .from('blocked_slots')
      .select('id')
      .eq('date', scheduled_date)
      .lte('start_time', scheduled_time)
      .gt('end_time', scheduled_time)

    const activeBookings = bookingCount || 0
    const availableSlots = (capacity || 0) - activeBookings
    const isBlocked = !!(blockedData && blockedData.length > 0)

    if ((availableSlots <= 0 || isBlocked) && !capacityOverrideApproved) {
      const conflictReason = isBlocked ? 'blocked' : 'full'
      const warning = isBlocked
        ? 'El horario está bloqueado en la agenda.'
        : `El horario ya tiene ${activeBookings} reserva${activeBookings === 1 ? '' : 's'} para una capacidad de ${capacity}.`
      return NextResponse.json(
        {
          error: 'Este horario requiere confirmación para crear un sobrecupo',
          requiresOverride: true,
          reason: conflictReason,
          warning,
          activeBookings,
          capacity,
        },
        { status: 409 }
      )
    }

    // Camión, resuelto ANTES de escribir nada: si el elegido no puede, no debe quedar ni
    // la ficha del cliente a medio crear.
    //
    // Elegido a mano: se respeta mientras no choque con la operación — que exista, que no
    // esté en mantención y que no tenga ya un trabajo que se pise a esa hora. Esas tres
    // son las que el selector deshabilita, así que acá solo llega por una carrera (otro
    // admin tomó el hueco) o por un llamado directo a la API.
    //
    // «Automático»: el mismo `pickVehicle` que usa el reparto. Se asigna en el momento
    // para que el camión quede visible de inmediato en el panel y en el link del chofer.
    // Las reservas de fechas pasadas no se auto-asignan (misma regla que el reparto).
    let vehicleIdToSave: number | null = null
    const occupiesTruck = !['cancelled', 'no_show'].includes(String(status))
    const manualVehicle =
      vehicleChoice !== undefined && vehicleChoice !== null && vehicleChoice !== 'auto'
        ? Number(vehicleChoice)
        : null
    if (manualVehicle !== null && !Number.isInteger(manualVehicle)) {
      return NextResponse.json({ error: 'Camión inválido' }, { status: 400 })
    }
    if (manualVehicle !== null || (occupiesTruck && scheduled_date >= chileTodayString())) {
      const availability = await getVehicleAvailability({
        scheduled_date,
        scheduled_time,
        duration_hours: Number(duration_hours) || null,
      })
      if (manualVehicle !== null) {
        const target = availability.vehicles.find((v) => v.id === manualVehicle)
        if (!target) {
          return NextResponse.json(
            { error: 'El camión indicado no existe en la flota' },
            { status: 400 }
          )
        }
        if (target.status === 'maintenance') {
          return NextResponse.json(
            { error: `${target.name} está en mantención: actívalo en Flota para asignarle trabajos` },
            { status: 409 }
          )
        }
        if (occupiesTruck && !target.available) {
          const choque = target.overlapping.map((o) => `${o.from}–${o.to}`).join(', ')
          return NextResponse.json(
            {
              error: `${target.name} ya tiene un trabajo a esa hora (${choque}). Elige otro camión o «Automático».`,
              vehicleUnavailable: true,
              vehicles: availability.vehicles,
            },
            { status: 409 }
          )
        }
        vehicleIdToSave = manualVehicle
      } else {
        vehicleIdToSave = availability.recommendedVehicleId
      }
    }

    const bookingQuoteId = quote_id || `ADMIN-${Date.now()}`
    const customerOrigin = normalizeOrigin(customer_origin)
    let customerRecordId: string | null = null

    // Una reserva manual normal deja primero una ficha vinculable en la misma base de
    // contactos. Los bloqueos de agenda usan esta misma API pero no son clientes.
    if (!skip_customer_record) {
      const normalizedEmail = String(client_email).trim().toLowerCase()
      const { data: customerRecord, error: customerError } = await supabaseAdmin
        .from('quote_prospects')
        .upsert(
          {
            quote_id: bookingQuoteId,
            name: client_name,
            email: normalizedEmail,
            phone: client_phone,
            source: customerOrigin,
            status: 'converted',
            scheduled_date,
            scheduled_time,
            total_price: original_price || total_price || null,
            origin_address: origin_address || null,
            destination_address: destination_address || null,
            is_company,
            company_name: is_company ? company_name || null : null,
            company_rut: is_company ? company_rut || null : null,
            notes: notes || null,
            // La clave va por EMAIL, no por quote_id.
            //
            // Antes era `admin_booking:${bookingQuoteId}`, y como el quote_id lleva un
            // timestamp, cada reserva manual creaba una ficha NUEVA de la misma persona:
            // medido en produccion el 2-sep-2026, 25 fichas para 17 personas, una de
            // ellas repetida 4 veces. El selector de clientes las unificaba por email
            // igual, pero en Prospectos se veian todas.
            //
            // No se usa `manual_customer:${email}` a proposito: esa es la clave de las
            // fichas que se crean a mano desde Clientes, y compartirla haria que una
            // reserva pisara las notas y el origen de esa ficha.
            lead_key: `admin_booking:${normalizedEmail}`,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'lead_key' }
        )
        .select('id')
        .single()

      if (customerError || !customerRecord) {
        console.error('[API] Error linking manual booking origin:', customerError)
        return NextResponse.json(
          {
            error:
              customerError?.code === '23514'
                ? 'Falta aplicar la migración de origen Cliente antiguo'
                : 'No se pudo guardar el origen del cliente',
          },
          { status: 500 }
        )
      }
      customerRecordId = customerRecord.id
    }

    // Solo se manda si se eligió: así crear reservas sigue funcionando aunque todavía no
    // esté corrida add_booking_tax_document.sql.
    const taxDocument = normalizeTaxDocument(taxDocumentInput)

    // Piso y ascensor: solo lo que venga con un valor válido. «Sin dato» no se inventa.
    const floorOf = (v: unknown) => {
      const n = Math.round(Number(v))
      return v !== undefined && v !== null && v !== '' && Number.isFinite(n) && n >= 0 && n <= 80 ? n : undefined
    }
    const accessFields: Record<string, unknown> = {}
    if (floorOf(origin_floor) !== undefined) accessFields.origin_floor = floorOf(origin_floor)
    if (floorOf(destination_floor) !== undefined) accessFields.destination_floor = floorOf(destination_floor)
    if (typeof origin_has_elevator === 'boolean') accessFields.origin_has_elevator = origin_has_elevator
    if (typeof destination_has_elevator === 'boolean') accessFields.destination_has_elevator = destination_has_elevator

    // Personas, volumen y distancia puestos a mano: se validan antes de crear nada.
    let operationalOverrides: OperationalOverrides = {}
    try {
      operationalOverrides = parseOperationalOverrides(body)
    } catch (error) {
      if (error instanceof OperationalError) return NextResponse.json({ error: error.message }, { status: error.status })
      throw error
    }

    // Crear la reserva
    const { data: booking, error: createError } = await supabaseAdmin
      .from('bookings')
      .insert({
        quote_id: bookingQuoteId,
        client_name,
        client_email: String(client_email).trim().toLowerCase(),
        client_phone,
        scheduled_date,
        scheduled_time,
        duration_hours,
        status,
        payment_type,
        payment_method: payment_method || null,
        payment_status: payment_status || 'pending',
        total_price: servicePrice || null,
        original_price: original_price || servicePrice || null,
        adjusted_price: original_price && servicePrice && Number(original_price) !== servicePrice ? servicePrice : null,
        amount_paid: amountReceived,
        payment_date: payment_status === 'approved' ? new Date().toISOString() : null,
        origin_address,
        destination_address,
        notes,
        is_company,
        company_name: is_company ? company_name : null,
        company_rut: is_company ? company_rut : null,
        ...(vehicleIdToSave !== null ? { vehicle_id: vehicleIdToSave } : {}),
        ...(taxDocument ? { tax_document: taxDocument } : {}),
        ...accessFields,
      })
      .select()
      .single()

    if (createError) {
      console.error('[API] Error creating booking:', createError)
      if (taxDocument && isMissingColumnError(createError)) {
        return NextResponse.json(
          {
            error:
              'Todavía no se puede guardar el documento tributario: falta correr la migración add_booking_tax_document.sql. Déjalo en «Sin definir» por ahora.',
          },
          { status: 400 }
        )
      }
      return NextResponse.json({ error: 'Error al crear la reserva' }, { status: 500 })
    }

    // Datos a mano: van después de crear, cada uno por su cuenta, para que una migración
    // faltante no impida crear la reserva.
    if (!skip_customer_record) await markBookingManual(booking.id)
    const operationalFailed = Object.keys(operationalOverrides).length
      ? await saveOperationalOverrides(booking.id, operationalOverrides)
      : []

    let paymentLedgerRecorded: boolean | null = null
    if (!skip_customer_record && booking.payment_status === 'approved' && amountReceived > 0) {
      const ledger = await recordPayment({
        bookingId: booking.id,
        quoteId: booking.quote_id,
        flowToken: null,
        amount: amountReceived,
        kind: 'manual',
        paidAt: booking.payment_date,
      })
      if (!ledger.recorded) {
        console.error('[API] Reserva creada con cobro, pero falta su movimiento en booking_payments:', booking.id)
      }
      paymentLedgerRecorded = ledger.recorded
    }

    if (customerRecordId) {
      const { error: linkError } = await supabaseAdmin
        .from('quote_prospects')
        .update({ converted_booking_id: booking.id, updated_at: new Date().toISOString() })
        .eq('id', customerRecordId)
      if (linkError) {
        // El match por quote_id sigue conservando el origen; no deshacemos una reserva
        // ya creada por un fallo secundario del enlace directo.
        console.error('[API] Error linking customer record to booking:', linkError)
      }
    }

    const methodLabels: Record<string, string> = {
      flow: 'link de pago',
      transfer: 'transferencia',
      cash: 'efectivo',
    }
    await logAdminAction({
      actor: getActorFromRequest(request),
      action: 'booking.created',
      entityType: 'booking',
      entityId: booking.id,
      entityLabel: [booking.client_name, booking.scheduled_date].filter(Boolean).join(' · '),
      summary: `Creó una reserva manual${capacityOverrideApproved ? ' con sobrecupo confirmado' : ''} para ${booking.scheduled_date} ${String(
        booking.scheduled_time || ''
      ).slice(0, 5)}${
        payment_method ? ` (cobro: ${methodLabels[payment_method] || payment_method})` : ''
      }`,
      changes: {
        created: {
          from: null,
          to: {
            quote_id: booking.quote_id,
            client_name: booking.client_name,
            scheduled_date: booking.scheduled_date,
            scheduled_time: booking.scheduled_time,
            total_price: booking.total_price,
            payment_method: booking.payment_method,
            status: booking.status,
            customer_origin: customerOrigin,
            override_capacity: capacityOverrideApproved,
            vehicle_id: vehicleIdToSave,
            vehicle_choice: manualVehicle !== null ? 'manual' : 'automatico',
          },
        },
      },
      request,
    })

    // Reserva nacida de una solicitud del panel: la solicitud queda aprobada y enlazada, y
    // la reserva hereda su empresa. Si ya la había aprobado otra persona no se enlaza dos
    // veces, pero la reserva recién creada se conserva.
    if (serviceRequestId) {
      const actor = getActorFromRequest(request)
      const approved = await approveRequestWithBooking(serviceRequestId, booking.id, actor?.username || null)
      if (approved) {
        await logAdminAction({
          actor,
          action: 'service_request.approved',
          entityType: 'service_request',
          entityId: String(serviceRequestId),
          entityLabel: approved.code,
          summary: `Aprobó la solicitud ${approved.code} y creó la reserva ${booking.code || booking.quote_id}`,
          changes: { status: { from: 'pendiente', to: 'aprobada' } },
          request,
        })
      }
    }

    // Correo de ingreso (#05). Hasta sep-2026 solo lo disparaba un pago de Flow, así que
    // las reservas cargadas a mano no lo recibían nunca: medido, 64 de 66 manuales desde
    // el 18-ago se quedaron sin él. Los bloqueos de agenda, las fechas pasadas y las
    // reservas tentativas quedan afuera (ver `bookingConfirmedSkipReason`). No lanza.
    if (!skip_customer_record) {
      await sendBookingConfirmedIfEligible(booking.id)
    }

    return NextResponse.json(
      {
        success: true,
        booking,
        paymentLedgerRecorded,
        // Datos a mano que no quedaron (falta alguna migración). Vacío = todo guardado.
        operationalWarning: operationalFailed.length ? `No se guardó: ${operationalFailed.join(', ')}.` : null,
        message: 'Reserva creada exitosamente',
      },
      { status: 201 }
    )
  } catch (error) {
    console.error('[API] Exception in /api/admin/bookings POST:', error)
    return NextResponse.json({ error: 'Error al crear la reserva' }, { status: 500 })
  }
}
