/**
 * ESTADO COMPLETO DEL COTIZADOR, para poder retomar una cotización desde «Mi cuenta».
 *
 * Lo que se guardaba hasta oct-2026 no alcanzaba para reabrir el cotizador: las direcciones
 * iban como una sola línea de texto, los ítems sin peso ni categoría y el tipo de propiedad
 * no se guardaba. Esto es una copia de lo que el cliente cargó, en la misma forma que usa
 * `quoteStore`, guardada en `quote_prospects.quote_state`.
 *
 * No lleva los datos personales (ya están en sus columnas) ni totales o precio: al retomar,
 * el cotizador los vuelve a calcular con los precios vigentes.
 *
 * Puro y sin dependencias del servidor: lo usan el navegador (al guardar y al cargar) y el
 * servidor (al validar lo que llega).
 */

export const QUOTE_STATE_VERSION = 1

export interface SavedQuoteState {
  v: number
  dateTime: string | null
  isFlexible: boolean
  origin: { address: Record<string, any> | null; details: Record<string, any> | null }
  destination: { address: Record<string, any> | null; details: Record<string, any> | null }
  stops: Record<string, any>[]
  items: Record<string, any>[]
  additionalServices: Record<string, any>
}

const MAX_ITEMS = 300
const MAX_STOPS = 10
const MAX_PHOTOS = 20
const MAX_BYTES = 200_000

const text = (value: unknown, max = 300): string => (typeof value === 'string' ? value.slice(0, max) : '')
const num = (value: unknown, fallback = 0): number => {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function address(raw: any): Record<string, any> | null {
  if (!raw || typeof raw !== 'object') return null
  const lat = Number(raw.coordinates?.lat)
  const lng = Number(raw.coordinates?.lng)
  return {
    street: text(raw.street),
    number: text(raw.number, 40),
    commune: text(raw.commune, 120),
    region: text(raw.region, 120),
    ...(raw.additionalInfo ? { additionalInfo: text(raw.additionalInfo) } : {}),
    ...(Number.isFinite(lat) && Number.isFinite(lng) ? { coordinates: { lat, lng } } : {}),
  }
}

function details(raw: any): Record<string, any> | null {
  if (!raw || typeof raw !== 'object') return null
  return {
    propertyType: text(raw.propertyType, 40) || 'casa',
    floor: num(raw.floor),
    hasElevator: Boolean(raw.hasElevator),
    parkingDistance: num(raw.parkingDistance),
  }
}

function item(raw: any): Record<string, any> | null {
  if (!raw || typeof raw !== 'object' || !raw.name) return null
  return {
    id: text(raw.id, 120),
    name: text(raw.name, 200),
    category: text(raw.category, 120),
    volume: num(raw.volume),
    weight: num(raw.weight),
    quantity: Math.max(1, Math.round(num(raw.quantity, 1))),
    isFragile: Boolean(raw.isFragile),
    isHeavy: Boolean(raw.isHeavy),
    isGlass: Boolean(raw.isGlass),
    ...(raw.image ? { image: text(raw.image, 500) } : {}),
    ...(raw.packaging && typeof raw.packaging === 'object'
      ? { packaging: { type: text(raw.packaging.type, 60), pricePerUnit: num(raw.packaging.pricePerUnit) } }
      : {}),
  }
}

/**
 * Deja el estado en una forma conocida, o null si no sirve para retomar. Vale tanto para lo
 * que manda el navegador como para lo que se lee de la base antes de devolverlo.
 */
export function sanitizeQuoteState(raw: unknown): SavedQuoteState | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as any
  const date = r.dateTime ? new Date(r.dateTime) : null
  const services = r.additionalServices && typeof r.additionalServices === 'object' ? r.additionalServices : {}

  const state: SavedQuoteState = {
    v: QUOTE_STATE_VERSION,
    dateTime: date && !Number.isNaN(date.getTime()) ? date.toISOString() : null,
    isFlexible: Boolean(r.isFlexible),
    origin: { address: address(r.origin?.address), details: details(r.origin?.details) },
    destination: { address: address(r.destination?.address), details: details(r.destination?.details) },
    stops: (Array.isArray(r.stops) ? r.stops : [])
      .slice(0, MAX_STOPS)
      .map((s: any) => {
        const base = address(s)
        if (!base) return null
        delete base.coordinates
        return { ...base, ...(s.note ? { note: text(s.note) } : {}) }
      })
      .filter(Boolean) as Record<string, any>[],
    items: (Array.isArray(r.items) ? r.items : []).slice(0, MAX_ITEMS).map(item).filter(Boolean) as Record<string, any>[],
    additionalServices: {
      disassembly: Boolean(services.disassembly),
      assembly: Boolean(services.assembly),
      packing: Boolean(services.packing),
      unpacking: Boolean(services.unpacking),
      observations: text(services.observations, 2000),
      photos: (Array.isArray(services.photos) ? services.photos : [])
        .filter((p: unknown) => typeof p === 'string')
        .slice(0, MAX_PHOTOS)
        .map((p: string) => p.slice(0, 500)),
      extraHelpers: Math.max(0, Math.round(num(services.extraHelpers))),
      fridgeDisassembly: Boolean(services.fridgeDisassembly),
      priority: Boolean(services.priority),
      stairsCarry: Boolean(services.stairsCarry),
    },
  }

  // Sin direcciones ni ítems no hay nada que retomar.
  if (!state.origin.address && !state.destination.address && state.items.length === 0) return null
  if (JSON.stringify(state).length > MAX_BYTES) return null
  return state
}

/** Lo que el cotizador manda a guardar junto con la cotización. */
export function buildQuoteState(state: {
  dateTime: Date | string | null
  isFlexible: boolean
  origin: any
  destination: any
  stops: any
  items: any[]
  additionalServices: any
}): SavedQuoteState | null {
  return sanitizeQuoteState(state)
}

/**
 * Fotos que el cliente subió en el cotizador. Quedan en `quote_state.additionalServices.photos`
 * de la cotización; la reserva las copia a `photo_urls`, pero las que se crean desde el panel o
 * que ya existían como pre-reserva no lo hacían (Tomás, 27-10-2026: «no se visualizan»).
 */
export function quoteStatePhotos(raw: unknown): string[] {
  const photos = (raw as any)?.additionalServices?.photos
  return (Array.isArray(photos) ? photos : [])
    .filter((p: unknown): p is string => typeof p === 'string' && p.trim() !== '')
    .slice(0, MAX_PHOTOS)
}

/** Une dos listas de fotos sin repetir, en el orden en que llegaron. */
export function mergePhotoUrls(current: unknown, added: string[]): string[] {
  let list: unknown = current
  if (typeof list === 'string') {
    try {
      list = JSON.parse(list)
    } catch {
      list = []
    }
  }
  const base = (Array.isArray(list) ? list : []).filter((p): p is string => typeof p === 'string')
  return Array.from(new Set([...base, ...added]))
}
