/**
 * LISTA DE PRECIOS POR DEFECTO — la que se usa cuando no se puede leer la configuración.
 *
 * Vivía copiada a mano en dos archivos (`pricingService` en el navegador y
 * `pricingConfigServer` en el servidor): doce números escritos dos veces, que tenían que
 * coincidir sin que nada lo comprobara. Acá están una sola vez.
 *
 * No importa nada del servidor a propósito, para que el navegador pueda usarla.
 */

import type { PricingConfig } from '@/lib/pricingService'
import { DEFAULT_HOME_VISIT_PRICE } from '@/lib/homeVisitPricing'
import { DEFAULT_EXTRA_SERVICES } from '@/lib/extraServices'
import { DEFAULT_CREW, DEFAULT_STAIRS } from '@/lib/crewPricing'

export const DEFAULT_PRICING_CONFIG: PricingConfig = {
  basePrice: 50000,
  pricePerCubicMeter: 15000,
  pricePerKilometer: 800,
  freeKilometers: 50,
  floorSurcharge: 5000,
  additionalServices: {
    packing: 25000,
    unpacking: 20000,
    disassembly: 15000,
    assembly: 15000,
    homeVisitPrice: DEFAULT_HOME_VISIT_PRICE,
    ...DEFAULT_EXTRA_SERVICES,
  },
  specialPackaging: {
    fragile: 10000,
    electronics: 15000,
    artwork: 25000,
  },
  timeSurcharges: {
    saturday: 20,
    sunday: 50,
    holiday: 100,
  },
  discounts: {
    flexibility: 10,
    advanceBooking: 5,
    repeatCustomer: 15,
  },
  crew: { ...DEFAULT_CREW },
  stairs: { ...DEFAULT_STAIRS },
}
