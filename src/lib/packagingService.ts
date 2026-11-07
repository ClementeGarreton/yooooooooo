/**
 * SERVICIO DE OPCIONES DE EMBALAJE
 *
 * Este servicio proporciona las opciones de embalaje disponibles
 * basadas en la configuración de precios de la base de datos.
 *
 * Los nombres y descripciones salen de `packagingCatalog`, que es el mismo
 * catálogo que usan el panel y los PDF: acá solo se le pega el precio vigente.
 */

import { getPricingConfig } from '@/lib/pricingService'
import { PACKAGING_TYPES } from '@/lib/packagingCatalog'

export interface PackagingOption {
  id: string
  name: string
  price: number
  description: string
  icon: string
}

/** Precios de respaldo si la configuración de la BD no está disponible. */
const FALLBACK_PRICES = {
  fragile: 10000,
  electronics: 15000,
  artwork: 25000,
} as const

function buildOptions(prices: Record<string, number>): PackagingOption[] {
  return PACKAGING_TYPES.map((type) => ({
    id: type.id,
    name: type.name,
    price: type.pricingKey ? prices[type.pricingKey] || 0 : 0,
    description: type.description,
    icon: '📦',
  }))
}

export async function getPackagingOptions(): Promise<PackagingOption[]> {
  try {
    const pricing = await getPricingConfig()
    return buildOptions(pricing.specialPackaging as unknown as Record<string, number>)
  } catch (error) {
    console.error('Error getting packaging options:', error)
    return buildOptions({ ...FALLBACK_PRICES })
  }
}
