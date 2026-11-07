/**
 * Datos del Panel del Cliente. TODA consulta filtra por el customer_id que viene de la
 * sesión firmada (customerSession.ts), nunca por algo que mande el navegador: es lo que
 * garantiza que cada persona o empresa vea solo lo suyo (punto 10 de la propuesta).
 */

import { sanitizeQuoteState, type SavedQuoteState } from '@/lib/quoteState'
import { supabaseAdmin } from '@/lib/supabase'
import { chileTodayString } from '@/lib/vehicleAssignment'
import { computeQuoteAmounts } from '@/lib/quoteCheckout'
import {
  actualPaidAmount,
  isOutstandingQuote,
  pendingAmount,
  quoteValue,
  servicePrice,
} from '@/lib/revenueBreakdown'
import {
  bookingVolumeM3,
  mergeBookingQuoteDetails,
  normalizeAdminPdfItems,
  type AdminBookingQuoteSource,
} from '@/lib/adminBookingQuoteData'
import { formatStopAddress, normalizeStops } from '@/lib/stops'

export interface AccountCustomer {
  id: string
  code: string
  name: string | null
  email: string
  phone: string | null
  is_company: boolean
  company_name: string | null
  company_rut: string | null
}

export interface AccountQuote {
  id: string
  code: string | null
  createdAt: string
  origin: string | null
  destination: string | null
  scheduledDate: string | null
  scheduledTime: string | null
  value: number
  isOutstanding: boolean
  hasPdf: boolean
  /** ¿Se puede reservar y pagar desde el panel? Ver `canReserveQuote`. */
  canReserve: boolean
  /** Lo que se cobraría en Flow, con la misma fórmula que el resumen del cotizador. */
  amounts: { abono50: number; full95: number }
  /** ¿Guardó el estado del cotizador? Entonces se puede retomar con todo cargado. */
  canResume: boolean
}

export interface AccountBooking {
  id: string
  code: string | null
  scheduledDate: string | null
  scheduledTime: string | null
  origin: string | null
  destination: string | null
  status: string | null
  price: number
  paid: number
  pending: number
}

export interface AccountBookingStop {
  address: string
  /** Lo que el cliente anotó para esa parada (cargar, dejar, retirar algo). */
  note: string | null
}

/** Detalle de una reserva (Módulo 1, paso 3): fecha, hora, direcciones, paradas y volumen. */
export interface AccountBookingDetail extends AccountBooking {
  /** Camión asignado (`bookings.vehicle_id`). null = todavía sin asignar. */
  vehicleId: number | null
  durationHours: number | null
  stops: AccountBookingStop[]
  /** m³ de la cotización enlazada. null = reserva sin cotización (cargada a mano). */
  volumeM3: number | null
  /** Artículos a trasladar (suma de cantidades). null = sin detalle de ítems. */
  itemCount: number | null
  /** ¿Se puede pagar el saldo por Flow desde el panel? Ver `canPayBalance`. */
  canPayBalance: boolean
}

export interface CustomerAccount {
  customer: AccountCustomer
  quotes: AccountQuote[]
  bookings: AccountBooking[]
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Columnas de una cotización que hacen falta para mostrarla, bajar su PDF o reservarla. */
const OWNED_QUOTE_FIELDS = `id, code, quote_id, source, created_at, name, email, phone, is_company,
  company_name, company_rut, origin_address, destination_address, scheduled_date, scheduled_time,
  origin_floor, origin_has_elevator, origin_parking_distance, destination_floor,
  destination_has_elevator, destination_parking_distance, total_price, adjusted_price, status,
  converted_booking_id, pdf_url, stops`

export interface OwnedQuote {
  id: string
  code: string | null
  quote_id: string | null
  source: string | null
  created_at: string
  name: string | null
  email: string | null
  phone: string | null
  is_company: boolean | null
  company_name: string | null
  company_rut: string | null
  origin_address: string | null
  destination_address: string | null
  scheduled_date: string | null
  scheduled_time: string | null
  origin_floor: number | null
  origin_has_elevator: boolean | null
  origin_parking_distance: number | null
  destination_floor: number | null
  destination_has_elevator: boolean | null
  destination_parking_distance: number | null
  total_price: number | null
  adjusted_price: number | null
  stops: unknown
  status: string | null
  converted_booking_id: string | null
  pdf_url: string | null
}

/**
 * ¿Se puede reservar desde el panel? Tiene que estar vigente (misma regla del dashboard),
 * tener `quote_id` —el pago, la pre-reserva y el webhook de Flow se enganchan por ahí;
 * medido el 01-10-2026: 253 de 1.243 filas no lo tienen— y no ser una visita a domicilio,
 * que no es una mudanza y se agenda por otro flujo.
 */
export function canReserveQuote(q: OwnedQuote, today: string = chileTodayString()): boolean {
  return isOutstandingQuote(q, today) && Boolean(q.quote_id) && q.source !== 'domicilio'
}

/**
 * Una cotización del cliente de la sesión, o null si no existe o es de otra persona.
 * Es la única puerta para las acciones sobre una cotización (PDF, reservar).
 */
export async function getOwnedQuote(
  customerId: string,
  prospectId: string
): Promise<OwnedQuote | null> {
  // Un id con otro formato no existe: se corta antes de que Postgres responda con error.
  if (!UUID_RE.test(prospectId)) return null
  const { data, error } = await supabaseAdmin
    .from('quote_prospects')
    .select(OWNED_QUOTE_FIELDS)
    .eq('id', prospectId)
    .eq('customer_id', customerId)
    .maybeSingle()

  if (error) {
    console.error('[customerAccount] Error leyendo la cotización:', error)
    return null
  }
  return (data as OwnedQuote | null) ?? null
}

/**
 * Cotizaciones del cliente que guardaron el estado del cotizador. Va en una consulta aparte
 * y tolerante: la columna es de `add_quote_state.sql`, y sin esa migración el panel tiene
 * que seguir abriendo (solo que sin el botón «Retomar»).
 */
async function resumableQuoteIds(customerId: string): Promise<Set<string>> {
  const { data, error } = await supabaseAdmin
    .from('quote_prospects')
    .select('id')
    .eq('customer_id', customerId)
    .not('quote_state', 'is', null)
  if (error) return new Set()
  return new Set((data || []).map((row: any) => row.id))
}

export interface QuoteResume {
  state: SavedQuoteState
  personalInfo: {
    name: string
    email: string
    phone: string
    isCompany: boolean
    companyName?: string
    companyRut?: string
  }
}

/**
 * Lo necesario para reabrir el cotizador con una cotización del cliente de la sesión: lo que
 * cargó en su momento y sus datos de contacto. null si no es suya o no guardó el estado.
 */
export async function getQuoteResume(customerId: string, prospectId: string): Promise<QuoteResume | null> {
  const quote = await getOwnedQuote(customerId, prospectId)
  if (!quote || quote.source === 'domicilio') return null
  const { data, error } = await supabaseAdmin
    .from('quote_prospects')
    .select('quote_state')
    .eq('id', quote.id)
    .eq('customer_id', customerId)
    .maybeSingle()
  if (error) return null
  const state = sanitizeQuoteState((data as any)?.quote_state)
  if (!state) return null
  // Una fecha que ya pasó no se puede reservar: se deja en blanco para que elija otra.
  if (state.dateTime && new Date(state.dateTime).getTime() < Date.now()) state.dateTime = null
  return {
    state,
    personalInfo: {
      name: quote.name || '',
      email: quote.email || '',
      phone: quote.phone || '',
      isCompany: Boolean(quote.is_company),
      ...(quote.is_company ? { companyName: quote.company_name || '', companyRut: quote.company_rut || '' } : {}),
    },
  }
}

/** Columnas de una reserva para el panel. `client_email` hace falta para emparejarla. */
const ACCOUNT_BOOKING_FIELDS = `id, code, quote_id, client_name, client_email, scheduled_date,
  scheduled_time, origin_address, destination_address, status, original_price, total_price,
  adjusted_price, amount_paid, payment_type, payment_status, is_provisional, flow_token,
  payment_method, vehicle_id`

/** ¿Es una reserva que el cliente debe ver? Ni bloqueos de agenda ni pagos a medio hacer. */
function isVisibleBooking(b: {
  quote_id?: string | null
  is_provisional?: boolean | null
  payment_status?: string | null
}): boolean {
  // Los bloqueos de agenda no son mudanzas de nadie.
  if (String(b.quote_id || '').startsWith('ADMIN-BLOQUEO-')) return false
  // Una pre-reserva sin pagar es un pago que se empezó y no se terminó: la persona la
  // sigue viendo como cotización vigente, desde donde puede volver a pagar.
  if (b.is_provisional && b.payment_status !== 'approved') return false
  return true
}

function toAccountBooking(b: any): AccountBooking {
  return {
    id: b.id,
    code: b.code,
    scheduledDate: b.scheduled_date,
    scheduledTime: b.scheduled_time,
    origin: b.origin_address,
    destination: b.destination_address,
    status: b.status,
    price: servicePrice(b),
    paid: actualPaidAmount(b),
    pending: pendingAmount(b),
  }
}

/**
 * ¿Puede el cliente pagar el saldo por Flow? Tiene que haber saldo (`pendingAmount`, que ya
 * excluye canceladas y no atendidas), `quote_id` —el cobro se engancha por ahí— y correo,
 * que Flow exige: las mismas condiciones que el link de saldo del panel admin.
 *
 * Y la mudanza tiene que ser HOY O DESPUÉS. Medido el 01-10-2026: de 30 reservas con saldo,
 * 26 eran mudanzas ya hechas, y en esas el saldo suele estar cobrado en efectivo o por
 * transferencia sin registrar. Ofrecerle «Pagar saldo» a ese cliente sería pedirle plata
 * que probablemente ya pagó; después del servicio el cobro lo maneja el equipo.
 */
export function canPayBalance(
  b: {
    quote_id?: string | null
    client_email?: string | null
    scheduled_date?: string | null
  } & Parameters<typeof pendingAmount>[0],
  today: string = chileTodayString()
): boolean {
  if (!b.scheduled_date || b.scheduled_date < today) return false
  return pendingAmount(b) > 0 && Boolean(b.quote_id) && Boolean(String(b.client_email || '').trim())
}

/**
 * Una reserva sobre la que esta persona puede ACTUAR (pagar, cambiar la fecha): sus reservas
 * personales, y las de su empresa solo si es el ENCARGADO de la cuenta. Un miembro ve las de
 * la empresa pero no las toca (ver `getCompanyBookingDetail`). Devuelve la fila, o null.
 */
async function getEditableBookingRow(customerId: string, bookingId: string, columns: string): Promise<any | null> {
  if (!UUID_RE.test(bookingId)) return null
  const { data, error } = await supabaseAdmin
    .from('bookings')
    .select(`${columns}, customer_id, company_id`)
    .eq('id', bookingId)
    .maybeSingle()
  if (error) {
    console.error('[customerAccount] Error leyendo la reserva:', error)
    return null
  }
  if (!data || !isVisibleBooking(data as any)) return null
  const row = data as any
  // Reserva de una empresa: manda el rol en la empresa, no quién la reservó. El encargado
  // puede actuar sobre todas; un miembro no edita ninguna, ni siquiera las que hizo él
  // (regla de Francisco, 06-10-2026: «el miembro ve pero no edita nada»).
  const company = await getCustomerCompany(customerId)
  if (company && (await isCompanyBooking(row, company.id, customerId))) {
    return company.role === 'encargado' ? row : null
  }
  return row.customer_id === customerId ? row : null
}

/**
 * ¿Esta reserva es un trabajo de la empresa? Lo es si está asignada a ella, o si no está
 * asignada a ninguna y la hizo alguien de la empresa. Lo segundo existe para que el historial
 * de la empresa esté completo sin depender de que alguien asigne cada reserva a mano (caso
 * Good life, 06-10-2026: 3 asignadas y 11 más de la misma persona sin asignar). La
 * facturación sigue usando solo las asignadas.
 */
async function isCompanyBooking(
  row: { company_id?: string | null; customer_id?: string | null },
  companyId: string,
  viewerId: string
): Promise<boolean> {
  if (row.company_id) return row.company_id === companyId
  if (!row.customer_id) return false
  if (row.customer_id === viewerId) return true // quien mira ya es de esta empresa
  const { data: owner } = await supabaseAdmin.from('customers').select('company_id').eq('id', row.customer_id).maybeSingle()
  return owner?.company_id === companyId
}

/** Fila de una reserva del cliente de la sesión con lo necesario para cobrarle el saldo. */
export async function getOwnedBookingForPayment(
  customerId: string,
  bookingId: string
): Promise<any | null> {
  return getEditableBookingRow(customerId, bookingId, ACCOUNT_BOOKING_FIELDS)
}

export interface OwnedBookingForReschedule {
  id: string
  code: string | null
  client_name: string | null
  quote_id: string | null
  status: string | null
  is_provisional: boolean | null
  payment_status: string | null
  booking_type: string | null
  scheduled_date: string | null
  scheduled_time: string | null
}

/**
 * Lo mínimo de una reserva del cliente de la sesión para reprogramarla, o null si no
 * existe, es de otra persona o no es visible en el panel.
 */
export async function getOwnedBookingForReschedule(
  customerId: string,
  bookingId: string
): Promise<OwnedBookingForReschedule | null> {
  const row = await getEditableBookingRow(
    customerId,
    bookingId,
    'id, code, client_name, quote_id, status, is_provisional, payment_status, booking_type, scheduled_date, scheduled_time'
  )
  return row as OwnedBookingForReschedule | null
}

/**
 * Detalle de una reserva del cliente de la sesión, o null si no existe, es de otra
 * persona o no es visible (bloqueo, pre-reserva sin pagar).
 *
 * El volumen y los artículos no viven en la reserva sino en su cotización: se emparejan
 * con `mergeBookingQuoteDetails`, la misma función que usa el panel admin, para que el
 * cliente vea los mismos m³ que la secretaría. Solo se le pasan las cotizaciones de ESTE
 * cliente, así que no puede enganchar datos de otra persona.
 */
export async function getOwnedBookingDetail(
  customerId: string,
  bookingId: string
): Promise<(AccountBookingDetail & { ownerName: string | null; own: boolean }) | null> {
  const booking = await getEditableBookingRow(customerId, bookingId, `${ACCOUNT_BOOKING_FIELDS}, duration_hours, stops`)
  if (!booking) return null
  // Las cotizaciones que se emparejan son las del DUEÑO de la reserva, no las de quien mira.
  const detail = await buildBookingDetail(booking, booking.customer_id || null)
  return { ...detail, ownerName: booking.client_name ?? null, own: booking.customer_id === customerId }
}

/** Arma el detalle de una reserva ya autorizada. `ownerId` = el cliente dueño de la reserva. */
async function buildBookingDetail(booking: any, ownerId: string | null): Promise<AccountBookingDetail> {
  let prospects: any[] = []
  if (ownerId) {
    const { data, error: prospectsError } = await supabaseAdmin
      .from('quote_prospects')
      .select(
        'quote_id, email, scheduled_date, scheduled_time, converted_booking_id, total_volume, items_summary'
      )
      .eq('customer_id', ownerId)
    if (prospectsError) {
      console.error('[customerAccount] Error leyendo las cotizaciones de la reserva:', prospectsError)
    }
    prospects = data || []
  }

  const [merged] = mergeBookingQuoteDetails(
    [booking as unknown as AdminBookingQuoteSource],
    prospects
  )
  const items = normalizeAdminPdfItems(merged.items_summary)
  const volume = bookingVolumeM3(merged)

  return {
    ...toAccountBooking(booking),
    vehicleId: typeof booking.vehicle_id === 'number' ? booking.vehicle_id : null,
    durationHours: Number(booking.duration_hours) || null,
    stops: normalizeStops(booking.stops).map((s) => ({
      address: formatStopAddress(s),
      note: s.note?.trim() || null,
    })),
    volumeM3: volume !== undefined ? Math.round(volume * 10) / 10 : null,
    itemCount: items.length > 0 ? items.reduce((sum, item) => sum + item.quantity, 0) : null,
    canPayBalance: canPayBalance(booking),
  }
}

/** null = el cliente de la sesión ya no existe (se borró): se trata como sin sesión. */
export async function getCustomerAccount(customerId: string): Promise<CustomerAccount | null> {
  const { data: customer, error } = await supabaseAdmin
    .from('customers')
    .select('id, code, name, email, phone, is_company, company_name, company_rut')
    .eq('id', customerId)
    .maybeSingle()

  if (error) throw new Error(`No se pudo leer el cliente: ${error.message}`)
  if (!customer) return null

  const [quotesRes, bookingsRes] = await Promise.all([
    supabaseAdmin
      .from('quote_prospects')
      .select(OWNED_QUOTE_FIELDS)
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
      .limit(50),
    supabaseAdmin
      .from('bookings')
      .select(ACCOUNT_BOOKING_FIELDS)
      .eq('customer_id', customerId)
      .order('scheduled_date', { ascending: false })
      .limit(50),
  ])

  if (quotesRes.error)
    throw new Error(`No se pudieron leer las cotizaciones: ${quotesRes.error.message}`)
  if (bookingsRes.error)
    throw new Error(`No se pudieron leer las reservas: ${bookingsRes.error.message}`)

  const today = chileTodayString()

  // Una misma cotización puede tener varias filas (medido el 01-10-2026: 22 quote_id
  // repetidos), por ejemplo si el cliente la volvió a guardar. Se muestra una sola, la
  // más reciente: la consulta viene ordenada por created_at descendente.
  const seenQuoteIds = new Set<string>()
  const quoteRows = ((quotesRes.data || []) as OwnedQuote[]).filter((q) => {
    if (!q.quote_id) return true
    if (seenQuoteIds.has(q.quote_id)) return false
    seenQuoteIds.add(q.quote_id)
    return true
  })

  const resumable = await resumableQuoteIds(customerId)

  const quotes: AccountQuote[] = quoteRows
    // Las que ya se convirtieron en reserva se ven como reserva, no dos veces.
    .filter((q) => !q.converted_booking_id && q.status !== 'converted')
    .map((q) => {
      const value = quoteValue(q)
      const amounts = computeQuoteAmounts(value)
      return {
        id: q.id,
        code: q.code,
        createdAt: q.created_at,
        origin: q.origin_address,
        destination: q.destination_address,
        scheduledDate: q.scheduled_date,
        scheduledTime: q.scheduled_time,
        value,
        isOutstanding: isOutstandingQuote(q, today),
        hasPdf: Boolean(q.pdf_url),
        canReserve: canReserveQuote(q, today),
        // No es una visita a domicilio: esas no pasan por el cotizador.
        canResume: resumable.has(q.id) && q.source !== 'domicilio',
        amounts: { abono50: amounts.abono50, full95: amounts.full95 },
      }
    })

  const bookings: AccountBooking[] = (bookingsRes.data || [])
    .filter(isVisibleBooking)
    .map(toAccountBooking)

  return { customer, quotes, bookings }
}

export interface AccountCompany {
  id: string
  code: string
  razon_social: string
  rut: string
  giro: string | null
  direccion: string | null
  comuna: string | null
  ciudad: string | null
  email_facturacion: string | null
  /** 'encargado' ve todo lo de la empresa; 'miembro' solo lo suyo. */
  role: 'encargado' | 'miembro'
}

/**
 * Empresa asociada al cliente de la sesión, o null. Tolera que la migración
 * add_panel_perfiles_fase2.sql todavía no esté corrida (columna o tabla inexistente):
 * en ese caso el cliente simplemente no tiene empresa.
 */
export async function getCustomerCompany(customerId: string): Promise<AccountCompany | null> {
  const { data: link, error } = await supabaseAdmin
    .from('customers')
    .select('company_id, company_role')
    .eq('id', customerId)
    .maybeSingle()
  if (error || !link?.company_id) return null

  const { data: company, error: companyError } = await supabaseAdmin
    .from('companies')
    .select('id, code, razon_social, rut, giro, direccion, comuna, ciudad, email_facturacion')
    .eq('id', link.company_id)
    .maybeSingle()
  if (companyError || !company) return null

  return { ...company, role: link.company_role === 'encargado' ? 'encargado' : 'miembro' }
}

/** Una reserva de la empresa, vista por alguien de la empresa. */
export interface CompanyAccountBooking extends AccountBooking {
  /** Quién la reservó. */
  clientName: string | null
  /** ¿Es de quien mira? */
  own: boolean
  /** ¿Puede pagarla o cambiarle la fecha? Solo el encargado de la cuenta. */
  canEdit: boolean
}

/**
 * Reservas asignadas a la empresa. Las ve cualquier persona de la empresa: el ENCARGADO
 * además puede actuar sobre todas; un miembro las ve todas en solo lectura.
 * Regla pedida por Francisco el 06-10-2026; antes el miembro no veía ninguna.
 */
export async function getCompanyBookings(
  customerId: string,
  company: AccountCompany | null
): Promise<CompanyAccountBooking[]> {
  if (!company) return []
  // Todo el historial: lo asignado a la empresa más lo que hicieron sus personas y nadie
  // asignó a ninguna empresa (ver `isCompanyBooking`).
  const { data: members } = await supabaseAdmin.from('customers').select('id').eq('company_id', company.id)
  const memberIds = (members || []).map((m) => m.id)
  let query = supabaseAdmin.from('bookings').select(`${ACCOUNT_BOOKING_FIELDS}, customer_id`)
  query =
    memberIds.length > 0
      ? query.or(`company_id.eq.${company.id},and(company_id.is.null,customer_id.in.(${memberIds.join(',')}))`)
      : query.eq('company_id', company.id)
  const { data, error } = await query.order('scheduled_date', { ascending: false }).limit(500)
  if (error) {
    console.error('[customerAccount] Error leyendo las reservas de la empresa:', error)
    return []
  }
  return (data || []).filter(isVisibleBooking).map((b: any) => ({
    ...toAccountBooking(b),
    clientName: b.client_name,
    own: b.customer_id === customerId,
    canEdit: company.role === 'encargado',
  }))
}

/**
 * Detalle en SOLO LECTURA de una reserva de la empresa, para cualquier persona de la
 * empresa. Devuelve null si la reserva no está asignada a su empresa. (El encargado no
 * llega acá: a él `getOwnedBookingDetail` ya le da la reserva con sus acciones.)
 */
export async function getCompanyBookingDetail(
  customerId: string,
  bookingId: string
): Promise<(AccountBookingDetail & { clientName: string | null }) | null> {
  if (!UUID_RE.test(bookingId)) return null
  const company = await getCustomerCompany(customerId)
  if (!company) return null

  const { data: booking, error } = await supabaseAdmin
    .from('bookings')
    .select(`${ACCOUNT_BOOKING_FIELDS}, duration_hours, stops, customer_id, company_id`)
    .eq('id', bookingId)
    .maybeSingle()
  if (error || !booking || !isVisibleBooking(booking)) return null
  if (!(await isCompanyBooking(booking as any, company.id, customerId))) return null

  const detail = await buildBookingDetail(booking, (booking as any).customer_id || null)
  // Solo lectura: pagar el saldo es de quien reservó o del encargado.
  return { ...detail, canPayBalance: false, clientName: (booking as any).client_name }
}
