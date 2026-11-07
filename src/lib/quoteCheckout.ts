import { supabaseAdmin } from '@/lib/supabase'
import { flowService, type FlowPaymentResponse } from '@/lib/flowService'
import {
  backfillAttribution,
  hasAttribution,
  type AttributionFields,
} from '@/lib/attributionServer'
import { siteUrl } from '@/lib/siteUrl'
import { mergePhotoUrls } from '@/lib/quoteState'
import { depositAmount } from '@/lib/revenueBreakdown'
import { normalizeStops } from '@/lib/stops'

export type PaymentType = 'completo' | 'mitad'

export interface QuoteClient {
  name?: string
  email?: string
  phone?: string
  isCompany?: boolean
  companyName?: string | null
  companyRut?: string | null
}

export interface QuoteSchedule {
  date: string | null
  time: string | null
}

export interface QuoteAddresses {
  origin?: string
  destination?: string
}

export interface QuotePropertyDetail {
  floor?: number | null
  hasElevator?: boolean | null
  parkingDistance?: number | null
}

export interface QuotePropertyDetails {
  origin?: QuotePropertyDetail | null
  destination?: QuotePropertyDetail | null
}

export interface EnsureBookingInput {
  quoteId: string
  client: QuoteClient
  schedule: QuoteSchedule
  addresses: QuoteAddresses
  propertyDetails?: QuotePropertyDetails
  estimatedPrice: number
  paymentType: PaymentType
  photoUrls?: string[]
  /**
   * Paradas intermedias de la cotización. Sin esto la reserva nacía solo con origen y
   * destino aunque el cliente hubiera cotizado (y pagado) una parada más. `undefined` = no
   * se tocan las de la reserva.
   */
  stops?: unknown
  /** Atribucion de Google Ads resuelta (cliente o heredada del prospecto por quoteId). */
  attribution?: AttributionFields
  /**
   * El cliente marcó la casilla de las Políticas de Garantía justo antes de esta llamada
   * (pagar en la página o pedir la cotización por correo). Se guarda la hora en
   * `bookings.policies_accepted_at`.
   */
  policiesAccepted?: boolean
}

/** Error tipado para que las rutas devuelvan 409 cuando el horario ya no tiene cupo. */
export class SlotUnavailableError extends Error {
  constructor() {
    super('Este horario ya no está disponible')
    this.name = 'SlotUnavailableError'
  }
}

/** Montos derivados del precio estimado mostrado al cliente. */
export function computeQuoteAmounts(estimatedPrice: number) {
  return {
    estimated: Math.round(estimatedPrice),
    // La mitad, con el piso de MIN_ABONO_CLP (ver depositAmount).
    abono50: depositAmount(estimatedPrice),
    full95: Math.round(estimatedPrice * 0.95), // 100% con 5% de descuento
  }
}

/**
 * Garantiza que exista UNA pre-reserva (booking) para este quoteId.
 * - Idempotente: si ya existe un booking con ese quote_id, lo reutiliza (no duplica).
 * - La crea como provisional (is_provisional=TRUE) => no consume cupo hasta que se paga.
 * - Verifica cupo contra bookings CONFIRMADOS/pendientes reales (no provisionales).
 */
export async function ensureProvisionalBooking(
  input: EnsureBookingInput
): Promise<{ quoteId: string; bookingRowId: string; existed: boolean; locked: boolean }> {
  const {
    quoteId,
    client,
    schedule,
    addresses,
    propertyDetails,
    estimatedPrice,
    paymentType,
    photoUrls,
    stops,
    attribution,
    policiesAccepted,
  } = input

  const stopsField =
    stops === undefined ? {} : { stops: normalizeStops(stops).length ? normalizeStops(stops) : null }

  if (!quoteId || !client?.name || !client?.email || !client?.phone) {
    throw new Error('Datos de cliente incompletos para crear la reserva')
  }
  if (!schedule?.date || !schedule?.time) {
    throw new Error('Fecha u hora de la mudanza faltante')
  }

  // Idempotencia: ¿ya existe el booking para este quoteId?
  const { data: existing, error: findError } = await supabaseAdmin
    .from('bookings')
    .select('id, is_provisional, payment_status, photo_urls, gclid, gbraid, wbraid, utm_source, utm_campaign')
    .eq('quote_id', quoteId)
    .maybeSingle()

  if (findError) {
    console.error('[quoteCheckout] Error buscando booking existente:', findError)
  }
  if (existing) {
    // El quote_id es estable durante toda la sesión: si el cliente vuelve atrás y cambia
    // fecha/precio/direcciones ANTES de pagar (o el admin reenvía la cotización ajustada),
    // hay que refrescar la pre-reserva — si no, queda pegada en los valores originales para
    // siempre, incluso después de pagar. Una vez que dejó de ser provisional o ya se aprobó
    // el pago, no se toca aquí: cualquier cambio a esa reserva debe hacerse explícitamente
    // desde el panel admin.
    const stillEditable =
      existing.is_provisional !== false && existing.payment_status !== 'approved'
    if (stillEditable) {
      const { error: refreshError } = await supabaseAdmin
        .from('bookings')
        .update({
          scheduled_date: schedule.date,
          scheduled_time: schedule.time,
          total_price: Math.round(estimatedPrice),
          original_price: Math.round(estimatedPrice),
          origin_address: addresses?.origin || null,
          destination_address: addresses?.destination || null,
          origin_floor: propertyDetails?.origin?.floor ?? null,
          origin_has_elevator: propertyDetails?.origin?.hasElevator ?? null,
          origin_parking_distance: propertyDetails?.origin?.parkingDistance ?? null,
          destination_floor: propertyDetails?.destination?.floor ?? null,
          destination_has_elevator: propertyDetails?.destination?.hasElevator ?? null,
          destination_parking_distance: propertyDetails?.destination?.parkingDistance ?? null,
          ...stopsField,
        })
        .eq('id', existing.id)
      if (refreshError) {
        console.error('[quoteCheckout] Error refrescando pre-reserva existente:', refreshError)
      }
    }
    // Las fotos del cliente se suman siempre, aunque ya haya pagado: si la pre-reserva se creó
    // antes (desde el panel o con otro envío) sin ellas, quedaban fuera de la reserva.
    const photos = Array.isArray(photoUrls) ? photoUrls.filter((p) => typeof p === 'string' && p) : []
    if (photos.length > 0) {
      const merged = mergePhotoUrls(existing.photo_urls, photos)
      if (merged.length !== mergePhotoUrls(existing.photo_urls, []).length) {
        const { error: photosError } = await supabaseAdmin.from('bookings').update({ photo_urls: merged }).eq('id', existing.id)
        if (photosError) console.error('[quoteCheckout] Error sumando fotos a la pre-reserva:', photosError)
      }
    }
    // Backfill de atribucion SOLO donde falte: nunca sobrescribe un gclid ya guardado.
    if (attribution && hasAttribution(attribution)) {
      await backfillAttribution('bookings', existing.id, attribution, existing)
    }
    // Una reserva ya pagada no se toca: su aceptación es la que quedó antes del pago.
    if (stillEditable && policiesAccepted) {
      await stampPoliciesAccepted(existing.id)
    }
    return { quoteId, bookingRowId: existing.id, existed: true, locked: !stillEditable }
  }

  // Verificar cupo real del horario (solo bookings no provisionales cuentan)
  const { data: configData, error: configError } = await supabaseAdmin
    .from('fleet_config')
    .select('num_vehicles')
    .single()

  if (configError || !configData) {
    throw new Error('Error obteniendo configuración de flota')
  }

  const { count: bookingCount } = await supabaseAdmin
    .from('bookings')
    .select('id', { count: 'exact', head: true })
    .eq('scheduled_date', schedule.date)
    .eq('scheduled_time', schedule.time)
    .eq('is_provisional', false)
    .in('status', ['confirmed', 'pending'])

  const { data: blockedData } = await supabaseAdmin
    .from('blocked_slots')
    .select('id')
    .eq('date', schedule.date)
    .lte('start_time', schedule.time)
    .gt('end_time', schedule.time)

  const availableSlots = configData.num_vehicles - (bookingCount || 0)
  const isBlocked = Boolean(blockedData && blockedData.length > 0)

  if (availableSlots <= 0 || isBlocked) {
    throw new SlotUnavailableError()
  }

  const isCompany = client.isCompany || false

  const { data: booking, error: createError } = await supabaseAdmin
    .from('bookings')
    .insert({
      quote_id: quoteId,
      client_name: client.name,
      client_email: client.email.trim().toLowerCase(),
      client_phone: client.phone,
      scheduled_date: schedule.date,
      scheduled_time: schedule.time,
      duration_hours: 4,
      status: 'pending',
      payment_status: 'pending',
      payment_type: paymentType,
      is_provisional: true, // no consume cupo hasta que Flow confirme el pago
      total_price: Math.round(estimatedPrice),
      original_price: Math.round(estimatedPrice),
      origin_address: addresses?.origin || null,
      destination_address: addresses?.destination || null,
      origin_floor: propertyDetails?.origin?.floor ?? null,
      origin_has_elevator: propertyDetails?.origin?.hasElevator ?? null,
      origin_parking_distance: propertyDetails?.origin?.parkingDistance ?? null,
      destination_floor: propertyDetails?.destination?.floor ?? null,
      destination_has_elevator: propertyDetails?.destination?.hasElevator ?? null,
      destination_parking_distance: propertyDetails?.destination?.parkingDistance ?? null,
      ...stopsField,
      is_company: isCompany,
      company_name: isCompany ? client.companyName || null : null,
      company_rut: isCompany ? client.companyRut || null : null,
      photo_urls: Array.isArray(photoUrls) && photoUrls.length > 0 ? photoUrls : [],
      ...(attribution && hasAttribution(attribution) ? attribution : {}),
    })
    .select('id')
    .single()

  if (createError || !booking) {
    console.error('[quoteCheckout] Error creando pre-reserva:', createError)
    throw new Error('Error al crear la reserva')
  }

  if (policiesAccepted) {
    await stampPoliciesAccepted(booking.id)
  }

  return { quoteId, bookingRowId: booking.id, existed: false, locked: false }
}

/**
 * Anota en la reserva la hora en que el cliente aceptó las Políticas de Garantía.
 *
 * Va en una escritura aparte del insert/refresh a propósito: si la columna todavía no
 * existe (la migración add_booking_policies_accepted.sql la corre Francisco a mano), la
 * reserva se crea y se refresca igual, y lo único que se pierde es esta marca, con un
 * aviso en el log. Nunca frena un pago.
 */
async function stampPoliciesAccepted(bookingId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('bookings')
    .update({ policies_accepted_at: new Date().toISOString() })
    .eq('id', bookingId)
  if (!error) return
  if (error.code === '42703' || error.code === 'PGRST204') {
    console.warn(
      '[quoteCheckout] Falta la columna bookings.policies_accepted_at: correr database/migrations/add_booking_policies_accepted.sql'
    )
  } else {
    console.error('[quoteCheckout] Error guardando la aceptación de políticas:', error)
  }
}

/**
 * Crea una orden de pago en Flow para este quoteId.
 * - commerceOrder único por intento (evita conflictos de duplicado en Flow).
 * - optional.bookingId = quoteId (estable) => el webhook resuelve SIEMPRE el mismo booking,
 *   sin importar cuántas órdenes (50% del correo, 50% en página, 100%) se hayan generado.
 */
export async function createQuoteFlowOrder(params: {
  quoteId: string
  paymentType: PaymentType
  amount: number
  email: string
  subject: string
}): Promise<FlowPaymentResponse> {
  const { quoteId, paymentType, amount, email, subject } = params
  const appUrl = siteUrl()

  return flowService.createPayment({
    commerceOrder: `${quoteId}-${paymentType}-${Date.now()}`,
    subject,
    currency: 'CLP',
    amount,
    email,
    urlConfirmation: `${appUrl}/api/payment/confirm`,
    urlReturn: `${appUrl}/api/payment/result`,
    optional: JSON.stringify({ bookingId: quoteId, paymentType }),
  })
}
