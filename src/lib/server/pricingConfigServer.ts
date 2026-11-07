/**
 * LECTURA DE LA CONFIGURACIÓN DE PRECIOS DESDE EL SERVIDOR.
 *
 * `getPricingConfig()` (src/lib/pricingService.ts) le pega a `/api/admin/pricing-config`
 * con una URL relativa, o sea que solo funciona en el navegador. El endpoint de
 * cotización corre en el servidor y necesita exactamente la misma configuración —con los
 * mismos valores por defecto y las mismas normalizaciones—, así que la lectura vive acá
 * y la usan tanto la ruta GET como `/api/quote/calculate`.
 *
 * Que sea una sola función es lo que evita que la web y el chat cotizen con
 * configuraciones distintas cuando una fila vieja no trae alguna clave.
 */

import { supabaseAdmin } from '@/lib/supabase'
import { DEFAULT_CREW, DEFAULT_STAIRS } from '@/lib/crewPricing'
import { DEFAULT_EXTRA_SERVICES, withExtraServicesDefaults } from '@/lib/extraServices'
import { DEFAULT_HOME_VISIT_PRICE, normalizeHomeVisitPrice } from '@/lib/homeVisitPricing'
import type { PricingConfig } from '@/lib/pricingService'
import { DEFAULT_PRICING_CONFIG } from '@/lib/pricingDefaults'

/**
 * Completa los servicios/recargos agregados en sep-2026 sobre lo que haya guardado.
 * Van dentro del JSONB `additional_services` para no necesitar migración, así que una
 * fila anterior simplemente no los trae y hay que rellenarlos al leer.
 */
export function withServiceDefaults(services: unknown) {
  const s = (services || {}) as Record<string, unknown>
  return {
    ...s,
    ...withExtraServicesDefaults(s),
    // La visita a domicilio vive acá dentro por el mismo motivo (la columna ya es JSONB),
    // pero se normaliza aparte: un 0 no la apaga, la dejaría cobrando nada.
    homeVisitPrice: normalizeHomeVisitPrice(s.homeVisitPrice),
  }
}

/**
 * Normaliza los bloques nuevos (cuadrilla y escaleras) contra los valores por defecto.
 * Una fila de `pricing_config` anterior a la migración no los tiene, y sin esto el
 * cotizador quedaría dividiendo por undefined.
 */
export function withCrewDefaults(crew: unknown) {
  const c = (crew || {}) as Partial<typeof DEFAULT_CREW>
  const num = (v: unknown, fallback: number) =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback
  return {
    includedPeople: Math.max(1, num(c.includedPeople, DEFAULT_CREW.includedPeople)),
    kgPerPerson: Math.max(1, num(c.kgPerPerson, DEFAULT_CREW.kgPerPerson)),
    pricePerExtraPerson: num(c.pricePerExtraPerson, DEFAULT_CREW.pricePerExtraPerson),
    maxPeople: Math.max(1, num(c.maxPeople, DEFAULT_CREW.maxPeople)),
  }
}

export function withStairsDefaults(stairs: unknown) {
  const s = (stairs || {}) as Partial<typeof DEFAULT_STAIRS>
  const itemsPerTrip =
    typeof s.itemsPerTrip === 'number' && s.itemsPerTrip >= 1
      ? s.itemsPerTrip
      : DEFAULT_STAIRS.itemsPerTrip
  return { itemsPerTrip }
}

// La lista por defecto vive en `@/lib/pricingDefaults`, compartida con el navegador.
export { DEFAULT_PRICING_CONFIG }

/**
 * Lee la configuración vigente (la fila más reciente) y la devuelve ya normalizada.
 *
 * Lanza si la consulta falla, en vez de devolver los valores por defecto en silencio:
 * cotizar con la lista de precios equivocada es peor que no cotizar.
 */
export async function readPricingConfig(): Promise<PricingConfig> {
  const { data: configs, error } = await supabaseAdmin
    .from('pricing_config')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1)

  if (error) {
    console.error('Error fetching pricing config:', error)
    throw new Error('Error obteniendo configuración de precios')
  }

  const config = configs?.[0]
  if (!config) return DEFAULT_PRICING_CONFIG

  return {
    basePrice: config.base_price,
    pricePerCubicMeter: config.price_per_cubic_meter,
    pricePerKilometer: config.price_per_kilometer,
    freeKilometers: config.free_kilometers || 50,
    floorSurcharge: config.floor_surcharge,
    additionalServices: withServiceDefaults(config.additional_services) as PricingConfig['additionalServices'],
    specialPackaging: config.special_packaging,
    timeSurcharges: config.time_surcharges,
    discounts: config.discounts,
    crew: withCrewDefaults(config.crew_config),
    stairs: withStairsDefaults(config.stairs_config),
  }
}
