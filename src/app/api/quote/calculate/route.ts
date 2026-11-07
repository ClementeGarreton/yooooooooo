import { NextRequest, NextResponse } from 'next/server'
import { calculateQuote, type QuoteItemInput } from '@/lib/quotePricing'
import { readPricingConfig } from '@/lib/server/pricingConfigServer'
import { measureRouteKm, toRoutePoint } from '@/lib/server/webQuotePrice'
import type { RoutePoint } from '@/lib/routeDistance'
import { computeQuoteAmounts } from '@/lib/quoteCheckout'

/**
 * COTIZAR SIN NAVEGADOR.
 *
 * El cálculo del precio vivía dentro del store de Zustand, o sea del lado del cliente:
 * la API recibía el total ya calculado y solo lo guardaba. El chatbot cotiza sin
 * browser, y si replicara la fórmula quedarían dos fuentes de verdad que se separan el
 * día que Tomás edita `pricing_config`.
 *
 * Esta ruta no tiene fórmula propia: arma el contexto (configuración vigente + distancia
 * real de la ruta) y llama a `calculateQuote`, exactamente lo mismo que hace el
 * cotizador web. La geocodificación pasa por las mismas guardas —incluida la de región,
 * que es la que evita cobrar cientos de kilómetros que no existen—.
 *
 * NO escribe nada: no crea prospecto ni reserva. Para eso están `/api/prospects/create`
 * y `/api/quote/checkout`.
 */

interface AddressInput extends Partial<RoutePoint> {
  floor?: number
  hasElevator?: boolean
}

function normalizeItems(raw: unknown): QuoteItemInput[] {
  if (!Array.isArray(raw)) return []
  return raw.map((item) => {
    const it = (item || {}) as Record<string, any>
    return {
      id: it.id != null ? String(it.id) : undefined,
      name: it.name != null ? String(it.name) : undefined,
      volume: Number(it.volume) || 0,
      weight: Number(it.weight) || 0,
      // Un item sin cantidad es un item: el cotizador web nunca manda 0 y asumir 0 acá
      // haría que el chat cotizara de menos por un campo que el otro canal da por hecho.
      quantity: Number(it.quantity) > 0 ? Number(it.quantity) : 1,
      isFragile: Boolean(it.isFragile),
      isGlass: Boolean(it.isGlass),
      packaging:
        it.packaging && typeof it.packaging === 'object'
          ? {
              type: String(it.packaging.type || 'none'),
              pricePerUnit: Number(it.packaging.pricePerUnit) || 0,
            }
          : undefined,
    }
  })
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    const items = normalizeItems(body.items)
    if (items.length === 0) {
      return NextResponse.json(
        { error: 'Se necesita al menos un item para cotizar', status: 'NO_ITEMS' },
        { status: 400 }
      )
    }

    const origin = (body.origin || null) as AddressInput | null
    const destination = (body.destination || null) as AddressInput | null
    const stops = Array.isArray(body.stops) ? (body.stops as AddressInput[]) : []

    const pricing = await readPricingConfig()

    // La distancia se puede mandar ya medida (por ejemplo para recotizar sin volver a
    // gastar geocodificaciones). Si no viene, se mide acá con las mismas reglas que la
    // web: origen → paradas en orden → destino, y ante cualquier fallo se cae al viaje
    // directo y después a la distancia por defecto, nunca a una suma parcial.
    let distanceKm: number
    const distanceDada = Number(body.distanceKm)
    if (Number.isFinite(distanceDada) && distanceDada >= 0) {
      distanceKm = distanceDada
    } else {
      const puntos = [toRoutePoint(origin), ...stops.map(toRoutePoint), toRoutePoint(destination)]
        .filter((p): p is RoutePoint => p !== null)

      distanceKm = await measureRouteKm(puntos)
    }

    const result = calculateQuote({
      items,
      origin: origin ? { floor: origin.floor, hasElevator: origin.hasElevator } : null,
      destination: destination
        ? { floor: destination.floor, hasElevator: destination.hasElevator }
        : null,
      distanceKm,
      dateTime: body.dateTime || null,
      isFlexible: Boolean(body.isFlexible),
      isCompany: Boolean(body.isCompany),
      additionalServices: body.additionalServices || null,
      pricing,
    })

    return NextResponse.json({
      ...result,
      totalDistance: distanceKm,
      // Los tres montos con los que se cobra, por la MISMA función que usan el checkout
      // y el reenvío del panel: el 5% de quien paga completo es un descuento definido en
      // un solo lugar, y que el chat lo recalcule por su cuenta es justamente lo que esta
      // ruta viene a evitar.
      amounts: computeQuoteAmounts(result.estimatedPrice),
    })
  } catch (error) {
    console.error('[quote/calculate] Error:', error)
    return NextResponse.json(
      { error: 'No se pudo calcular la cotización' },
      { status: 500 }
    )
  }
}
