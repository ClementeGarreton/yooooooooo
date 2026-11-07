import { calculateQuote, type QuoteItemInput } from '@/lib/quotePricing'
import { readPricingConfig } from '@/lib/server/pricingConfigServer'
import { geocodeAddressServer, segmentDistanceServer } from '@/lib/server/geoapifyServer'
import { routeDistanceWith, type RoutePoint } from '@/lib/routeDistance'
import { sanitizeQuoteState, type SavedQuoteState } from '@/lib/quoteState'
import { MAPS_CONFIG } from '@/config/maps'
import type { PricingConfig } from '@/lib/pricingService'

/**
 * PRECIO DE LA WEB, COMPROBADO EN EL SERVIDOR.
 *
 * El pago en la página y el correo con link de pago cobraban sobre el total que calculó el
 * navegador: cualquiera podía pedir una orden de $1.000 para una mudanza de $300.000. Acá se
 * vuelve a cotizar con `calculateQuote`, la misma fórmula, sobre lo que el cliente declaró.
 *
 * Por eso no impide declarar menos de lo que se va a mover: los ítems a medida los mide el
 * cliente y el precio se valida en terreno. Lo que cierra es un precio sin relación con lo
 * declarado, y lo declarado queda guardado en la cotización.
 */

/**
 * Bajo esta fracción del precio recalculado no se cobra. Es holgado a propósito: en la semana
 * del 24 al 31-10-2026 el precio guardado más bajo fue 0,72 veces el recalculado, y rechazar
 * a un cliente real cuesta una venta. Las diferencias menores quedan en el registro para
 * poder acercar este piso con datos.
 */
const PISO_PRECIO_WEB = 0.5
/** Diferencia desde la que se anota en el registro, aunque se cobre. */
const AVISO_DIFERENCIA = 0.01
/** Con Geoapify lento se sigue con la distancia por defecto: el cobro no puede quedar colgado. */
const DISTANCIA_TIMEOUT_MS = 8000

export function toRoutePoint(address: Partial<RoutePoint> | null | undefined): RoutePoint | null {
  if (!address || !address.street || !address.commune) return null
  return {
    street: String(address.street),
    number: String(address.number || ''),
    commune: String(address.commune),
    region: String(address.region || ''),
  }
}

/**
 * Distancia real de la ruta, con las mismas reglas que la web: origen → paradas en orden →
 * destino, y ante cualquier fallo se cae al viaje directo y después a la distancia por
 * defecto, nunca a una suma parcial.
 */
export function measureRouteKm(points: RoutePoint[]): Promise<number> {
  return routeDistanceWith(points, {
    geocode: async (p) => {
      const r = await geocodeAddressServer(p)
      return r.ok ? { lat: r.lat, lng: r.lng } : null
    },
    segmentKm: async (a, b) => {
      const r = await segmentDistanceServer(a.lat, a.lng, b.lat, b.lng)
      return r.ok ? r.kilometers : null
    },
    defaultDistance: MAPS_CONFIG.defaultDistance,
  })
}

const positivo = (value: unknown) => Math.max(0, Number(value) || 0)

/** Cotiza lo declarado con la distancia ya medida. Sin red: lo usa también la comprobación contra datos. */
export function priceOfQuoteState(state: SavedQuoteState, distanceKm: number, pricing: PricingConfig): number {
  // El estado admite negativos porque solo se pensó para retomar una cotización; acá un
  // volumen o un embalaje negativo bajaría el precio.
  const items: QuoteItemInput[] = state.items.map((item) => ({
    id: item.id,
    name: item.name,
    volume: positivo(item.volume),
    weight: positivo(item.weight),
    quantity: item.quantity,
    isFragile: Boolean(item.isFragile),
    isGlass: Boolean(item.isGlass),
    packaging: item.packaging
      ? { type: String(item.packaging.type || 'none'), pricePerUnit: positivo(item.packaging.pricePerUnit) }
      : undefined,
  }))

  return calculateQuote({
    items,
    origin: state.origin.details
      ? { floor: positivo(state.origin.details.floor), hasElevator: Boolean(state.origin.details.hasElevator) }
      : null,
    destination: state.destination.details
      ? { floor: positivo(state.destination.details.floor), hasElevator: Boolean(state.destination.details.hasElevator) }
      : null,
    distanceKm,
    dateTime: state.dateTime,
    isFlexible: state.isFlexible,
    additionalServices: state.additionalServices,
    pricing,
  }).estimatedPrice
}

async function routeKmOf(state: SavedQuoteState): Promise<number> {
  const puntos = [state.origin.address, ...state.stops, state.destination.address]
    .map((p) => toRoutePoint(p))
    .filter((p): p is RoutePoint => p !== null)

  let timer: ReturnType<typeof setTimeout> | undefined
  const limite = new Promise<number>((resolve) => {
    timer = setTimeout(() => resolve(MAPS_CONFIG.defaultDistance), DISTANCIA_TIMEOUT_MS)
  })
  try {
    return await Promise.race([measureRouteKm(puntos), limite])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Compara un precio de la web con el recalculado. Devuelve el mensaje para el cliente si no
 * se debe cobrar, o null si se puede seguir.
 *
 * Una falla nuestra al leer los precios no rechaza a nadie: deja pasar y queda anotada. Lo
 * que llega del navegador sí: sin inventario no hay contra qué cobrar.
 */
export async function webQuotePriceProblem(
  ruta: string,
  quoteId: string,
  price: number,
  rawState: unknown
): Promise<string | null> {
  const state = sanitizeQuoteState(rawState)
  if (!state || state.items.length === 0) {
    console.warn(`[${ruta}] ${quoteId}: sin inventario para comprobar el precio`)
    return 'Actualizamos el cotizador. Recarga la página para continuar: tu cotización sigue guardada.'
  }

  let pricing: PricingConfig
  try {
    pricing = await readPricingConfig()
  } catch (error) {
    console.error(`[${ruta}] ${quoteId}: no se pudo leer la configuración de precios:`, error)
    return null
  }

  const esperado = priceOfQuoteState(state, await routeKmOf(state), pricing)
  const pedido = Number(price)
  const fraccion = esperado > 0 ? pedido / esperado : 1

  if (!Number.isFinite(pedido) || pedido <= 0 || fraccion < PISO_PRECIO_WEB) {
    console.warn(`[${ruta}] ${quoteId}: precio rechazado. Pedido $${price}, recalculado $${esperado}`)
    return 'El precio de esta cotización cambió. Recarga la página y revisa el resumen antes de pagar.'
  }
  if (Math.abs(fraccion - 1) >= AVISO_DIFERENCIA) {
    console.info(`[${ruta}] ${quoteId}: diferencia de precio. Pedido $${pedido}, recalculado $${esperado}`)
  }
  return null
}
