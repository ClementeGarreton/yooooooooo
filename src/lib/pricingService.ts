/**
 * SERVICIO DE CONFIGURACIÓN DE PRECIOS
 * 
 * Este servicio obtiene la configuración de precios desde la base de datos
 * y la convierte al formato esperado por el sistema de cotización.
 */

import { DEFAULT_CREW, DEFAULT_STAIRS, type CrewConfig, type StairsConfig } from '@/lib/crewPricing'
import { DEFAULT_EXTRA_SERVICES, type ExtraServicesConfig } from '@/lib/extraServices'
import { DEFAULT_PRICING_CONFIG } from '@/lib/pricingDefaults'

export interface PricingConfig {
  basePrice: number
  pricePerCubicMeter: number
  pricePerKilometer: number
  freeKilometers: number
  floorSurcharge: number
  /** Personas incluidas, escalón de peso y precio por persona extra. */
  crew: CrewConfig
  /** Cada cuántos bultos se repite el cargo por piso. */
  stairs: StairsConfig
  /**
   * Los 4 campos de `ExtraServicesConfig` (desarmado de refrigerador, Priority y el
   * recargo por exceso de volumen) viven acá dentro a propósito: `additional_services`
   * ya es una columna JSONB, así que agregarlos NO necesita migración. Una fila vieja
   * que no los tenga se completa con los valores por defecto al leerla.
   */
  additionalServices: {
    packing: number
    unpacking: number
    disassembly: number
    assembly: number
    /** Precio de la visita a domicilio. Ver `homeVisitPricing.ts`. */
    homeVisitPrice: number
  } & ExtraServicesConfig
  specialPackaging: {
    fragile: number
    electronics: number
    artwork: number
  }
  timeSurcharges: {
    saturday: number
    sunday: number
    holiday: number
  }
  discounts: {
    flexibility: number
    advanceBooking: number
    repeatCustomer: number
  }
}

// Cache para evitar múltiples llamadas
let pricingCache: PricingConfig | null = null
let cacheTimestamp: number = 0
const CACHE_DURATION = 5 * 60 * 1000 // 5 minutos

export async function getPricingConfig(): Promise<PricingConfig> {
  // Verificar cache
  const now = Date.now()
  if (pricingCache && (now - cacheTimestamp) < CACHE_DURATION) {
    return pricingCache
  }

  try {
    const response = await fetch('/api/admin/pricing-config')
    if (!response.ok) {
      throw new Error('Error obteniendo configuración de precios')
    }
    
    const config = await response.json()
    
    // Actualizar cache
    pricingCache = config
    cacheTimestamp = now
    
    return config
  } catch (error) {
    console.error('Error fetching pricing config:', error)
    
    // Devolver configuración por defecto si falla. Es el MISMO objeto que usa el
    // servidor cuando la tabla está vacía: antes eran dos copias escritas a mano.
    return DEFAULT_PRICING_CONFIG
  }
}

// Función para limpiar cache (útil cuando se actualiza la configuración)
export function clearPricingCache() {
  pricingCache = null
  cacheTimestamp = 0
}
