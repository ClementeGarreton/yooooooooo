import type { AdminQuoteData } from './adminQuotePdf'
import { normalizeStops } from './stops'

export type AdminPdfItem = {
  name: string
  quantity: number
  volume: number
  /**
   * `pricePerUnit` es el precio por m³ del embalaje congelado al cotizar. Se
   * conserva (antes se descartaba) porque el panel ahora lo muestra y permite
   * corregirlo sin rehacer la cotización.
   */
  packaging: { type: string; pricePerUnit?: number } | undefined
}

export interface BookingQuoteDetails {
  quote_id?: string | null
  email?: string | null
  source?: string | null
  status?: string | null
  is_frequent?: boolean | null
  scheduled_date?: string | null
  scheduled_time?: string | null
  converted_booking_id?: string | null
  is_flexible?: boolean | null
  recommended_vehicle?: string | null
  total_volume?: number | string | null
  total_weight?: number | string | null
  total_distance?: number | string | null
  origin_floor?: number | null
  origin_has_elevator?: boolean | null
  origin_parking_distance?: number | null
  destination_floor?: number | null
  destination_has_elevator?: boolean | null
  destination_parking_distance?: number | null
  items_summary?: unknown
  additional_services?: unknown
  lead_key?: string | null
}

export interface AdminBookingQuoteSource {
  id?: string | null
  quote_id?: string | null
  client_name: string
  client_email?: string | null
  client_phone?: string | null
  /** Origen de marketing del prospecto del que proviene esta reserva (si aplica). */
  source?: string | null
  /** true si la reserva se enriqueció con un prospecto coincidente. */
  from_prospect?: boolean
  /** true si el cliente está marcado como frecuente (vive en quote_prospects). */
  is_frequent?: boolean | null
  is_company?: boolean | null
  company_name?: string | null
  company_rut?: string | null
  origin_address?: string | null
  destination_address?: string | null
  visit_address?: string | null
  origin_floor?: number | null
  origin_has_elevator?: boolean | null
  origin_parking_distance?: number | null
  destination_floor?: number | null
  destination_has_elevator?: boolean | null
  destination_parking_distance?: number | null
  scheduled_date?: string | null
  scheduled_time?: string | null
  /** Nota escrita en el panel sobre esta reserva. Sale en los dos PDF. */
  notes?: string | null
  /** Paradas intermedias (JSONB). */
  stops?: unknown
  /** Notas del chofer, adjuntadas por /api/admin/bookings. Solo van a la orden de trabajo. */
  driver_notes?: Array<{
    note: string
    vehicle_label?: string | null
    created_at?: string | null
  }> | null
  /** Código legible de la reserva (RES-000001). Lo pone la base; ausente sin la migración. */
  code?: string | null
  /** Cliente al que pertenece (tabla customers). Ausente sin la migración. */
  customer_id?: string | null
  total_price?: number | string | null
  original_price?: number | string | null
  adjusted_price?: number | string | null
  is_flexible?: boolean | null
  recommended_vehicle?: string | null
  total_volume?: number | string | null
  total_weight?: number | string | null
  total_distance?: number | string | null
  items_summary?: unknown
  additional_services?: unknown
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

function parseJsonValue(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function normalizeText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

function normalizeDate(value: unknown): string {
  return typeof value === 'string' ? value.slice(0, 10) : ''
}

function normalizeTime(value: unknown): string {
  return typeof value === 'string' ? value.slice(0, 5) : ''
}

function normalizeEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function normalizeCustomerOrigin(value: unknown): string {
  return value === 'cliente_antiguo' || value === 'rrss' || value === 'recomendacion'
    ? value
    : 'web'
}

function scheduleKey(email: unknown, date: unknown, time: unknown): string {
  const normalizedEmail = normalizeEmail(email)
  const normalizedDate = normalizeDate(date)
  const normalizedTime = normalizeTime(time)
  return normalizedEmail && normalizedDate && normalizedTime
    ? `${normalizedEmail}|${normalizedDate}|${normalizedTime}`
    : ''
}

function normalizeAdditionalServices(value: unknown): Record<string, any> | undefined {
  const parsed = parseJsonValue(value)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
  return parsed as Record<string, any>
}

/**
 * Igual que `normalizeAdminPdfItems`, pero conservando la posición original dentro
 * de `items_summary`. El editor de precios del panel la necesita: la normalización
 * descarta filas corruptas, así que sin el índice no habría forma de escribir el
 * precio sobre la fila correcta del JSON guardado.
 */
export type IndexedAdminPdfItem = AdminPdfItem & { sourceIndex: number }

export function normalizeAdminPdfItemsWithIndex(
  value: unknown,
  totalVolume?: number | string | null
): IndexedAdminPdfItem[] {
  const parsed = parseJsonValue(value)
  if (!Array.isArray(parsed)) return []

  const items = parsed
    .map((item, sourceIndex): IndexedAdminPdfItem | null => {
      if (!item || typeof item !== 'object') return null
      const record = item as Record<string, unknown>
      const name = normalizeText(record.name)
      const quantity = toNumber(record.quantity) || 0
      const volume = toNumber(record.volume) || 0
      if (!name || quantity <= 0 || volume < 0) return null
      const packagingRecord = record.packaging as Record<string, unknown> | undefined
      const packagingType = packagingRecord ? normalizeText(packagingRecord.type) : undefined
      const packagingPrice = packagingRecord ? toNumber(packagingRecord.pricePerUnit) : undefined
      const packaging =
        packagingType && packagingType !== 'none'
          ? { type: packagingType, pricePerUnit: packagingPrice }
          : undefined
      return { name, quantity, volume, packaging, sourceIndex }
    })
    .filter((item): item is IndexedAdminPdfItem => Boolean(item))

  if (items.length === 0) return []

  const expectedTotal = toNumber(totalVolume)
  const rawSum = items.reduce((sum, item) => sum + item.volume, 0)
  const renderedRawSum = items.reduce((sum, item) => sum + item.volume * item.quantity, 0)
  const hasExpectedTotal = typeof expectedTotal === 'number' && expectedTotal > 0
  const epsilon = 0.05

  const rawLooksLikeLineTotals =
    !hasExpectedTotal ||
    Math.abs(rawSum - expectedTotal) <= epsilon ||
    Math.abs(renderedRawSum - expectedTotal) > epsilon

  return items.map((item) => ({
    ...item,
    volume: rawLooksLikeLineTotals ? item.volume / item.quantity : item.volume,
  }))
}

export function normalizeAdminPdfItems(
  value: unknown,
  totalVolume?: number | string | null
): AdminPdfItem[] {
  return normalizeAdminPdfItemsWithIndex(value, totalVolume).map(
    ({ sourceIndex: _sourceIndex, ...item }) => item
  )
}

/** Volumen disponible para la lista de reservas, con respaldo en el detalle de ítems. */
export function bookingVolumeM3(booking: AdminBookingQuoteSource): number | undefined {
  const direct = toNumber(booking.total_volume)
  if (direct !== undefined && direct >= 0) return direct

  const items = normalizeAdminPdfItems(booking.items_summary)
  if (items.length === 0) return undefined
  return items.reduce((sum, item) => sum + item.volume * item.quantity, 0)
}

function pickQuoteDetails(prospect?: BookingQuoteDetails): Partial<AdminBookingQuoteSource> {
  if (!prospect) return {}

  const details: Partial<AdminBookingQuoteSource> = {}
  if (prospect.is_flexible !== undefined && prospect.is_flexible !== null) {
    details.is_flexible = prospect.is_flexible
  }
  if (prospect.recommended_vehicle) details.recommended_vehicle = prospect.recommended_vehicle
  if (prospect.total_volume !== undefined && prospect.total_volume !== null) details.total_volume = prospect.total_volume
  if (prospect.total_weight !== undefined && prospect.total_weight !== null) details.total_weight = prospect.total_weight
  if (prospect.total_distance !== undefined && prospect.total_distance !== null) details.total_distance = prospect.total_distance
  if (prospect.origin_floor !== undefined && prospect.origin_floor !== null) details.origin_floor = prospect.origin_floor
  if (prospect.origin_has_elevator !== undefined && prospect.origin_has_elevator !== null) details.origin_has_elevator = prospect.origin_has_elevator
  if (prospect.origin_parking_distance !== undefined && prospect.origin_parking_distance !== null) details.origin_parking_distance = prospect.origin_parking_distance
  if (prospect.destination_floor !== undefined && prospect.destination_floor !== null) details.destination_floor = prospect.destination_floor
  if (prospect.destination_has_elevator !== undefined && prospect.destination_has_elevator !== null) details.destination_has_elevator = prospect.destination_has_elevator
  if (prospect.destination_parking_distance !== undefined && prospect.destination_parking_distance !== null) details.destination_parking_distance = prospect.destination_parking_distance
  if (prospect.items_summary !== undefined && prospect.items_summary !== null) details.items_summary = prospect.items_summary
  if (prospect.additional_services !== undefined && prospect.additional_services !== null) {
    details.additional_services = prospect.additional_services
  }
  if (prospect.source) details.source = prospect.source
  if (prospect.is_frequent !== undefined && prospect.is_frequent !== null) {
    details.is_frequent = prospect.is_frequent
  }
  // Solo se invoca cuando hubo match con un prospecto => marca el origen de la reserva.
  details.from_prospect = true
  return details
}

export function mergeBookingQuoteDetails<T extends AdminBookingQuoteSource>(
  bookings: T[],
  prospects: BookingQuoteDetails[]
): Array<T & Partial<BookingQuoteDetails>> {
  const byBookingId = new Map<string, BookingQuoteDetails>()
  const byQuoteId = new Map<string, BookingQuoteDetails>()
  const bySchedule = new Map<string, BookingQuoteDetails>()
  const customerByEmail = new Map<
    string,
    Pick<BookingQuoteDetails, 'source' | 'is_frequent'> & { priority: number }
  >()

  prospects.forEach((prospect) => {
    const convertedBookingId = normalizeText(prospect.converted_booking_id)
    if (convertedBookingId && !byBookingId.has(convertedBookingId)) {
      byBookingId.set(convertedBookingId, prospect)
    }

    const quoteId = normalizeText(prospect.quote_id)
    if (quoteId && !byQuoteId.has(quoteId)) {
      byQuoteId.set(quoteId, prospect)
    }

    const key = scheduleKey(prospect.email, prospect.scheduled_date, prospect.scheduled_time)
    if (key && !bySchedule.has(key)) {
      bySchedule.set(key, prospect)
    }

    const email = normalizeEmail(prospect.email)
    if (email) {
      const existing = customerByEmail.get(email)
      const nextOrigin = normalizeCustomerOrigin(prospect.source)
      const isManualCustomer = String(prospect.lead_key || '').startsWith('manual_customer:')
      const priority = isManualCustomer ? 3 : nextOrigin === 'cliente_antiguo' ? 2 : 1
      customerByEmail.set(email, {
        source: !existing || priority >= existing.priority ? nextOrigin : existing.source,
        is_frequent: Boolean(existing?.is_frequent) || Boolean(prospect.is_frequent),
        priority: Math.max(priority, existing?.priority || 0),
      })
    }
  })

  return bookings.map((booking) => {
    const prospect =
      (booking.id ? byBookingId.get(booking.id) : undefined) ||
      (booking.quote_id ? byQuoteId.get(booking.quote_id) : undefined) ||
      bySchedule.get(scheduleKey(booking.client_email, booking.scheduled_date, booking.scheduled_time))

    const customer = customerByEmail.get(normalizeEmail(booking.client_email))
    if (!prospect && !customer) return booking

    const merged = {
      ...booking,
      ...pickQuoteDetails(prospect),
    }
    if (customer?.priority === 3 || customer?.source === 'cliente_antiguo' || !merged.source) {
      merged.source = customer?.source || merged.source
    }
    if (customer?.is_frequent) merged.is_frequent = true
    if (!merged.from_prospect && customer) merged.from_prospect = true
    return merged
  })
}

export function bookingToAdminQuoteData(booking: AdminBookingQuoteSource): AdminQuoteData {
  return {
    name: booking.client_name,
    email: booking.client_email,
    phone: booking.client_phone,
    isCompany: booking.is_company || false,
    companyName: booking.company_name,
    companyRut: booking.company_rut,
    originAddress: booking.origin_address || booking.visit_address,
    destinationAddress: booking.destination_address,
    originFloor: booking.origin_floor ?? undefined,
    originHasElevator: booking.origin_has_elevator ?? undefined,
    originParkingDistance: booking.origin_parking_distance ?? undefined,
    destinationFloor: booking.destination_floor ?? undefined,
    destinationHasElevator: booking.destination_has_elevator ?? undefined,
    destinationParkingDistance: booking.destination_parking_distance ?? undefined,
    scheduledDate: booking.scheduled_date,
    scheduledTime: booking.scheduled_time,
    totalPrice:
      toNumber(booking.adjusted_price) ??
      toNumber(booking.original_price) ??
      toNumber(booking.total_price),
    isFlexible: booking.is_flexible || false,
    recommendedVehicle: booking.recommended_vehicle,
    totalVolume: bookingVolumeM3(booking),
    totalWeight: toNumber(booking.total_weight),
    totalDistance: toNumber(booking.total_distance),
    items: normalizeAdminPdfItems(booking.items_summary, booking.total_volume),
    additionalServices: normalizeAdditionalServices(booking.additional_services),
    notes: booking.notes,
    code: booking.code,
    stops: normalizeStops(booking.stops),
    driverNotes: booking.driver_notes || [],
  }
}
