import type { PricingConfig } from '@/lib/pricingService'
import type { SavedQuoteState } from '@/lib/quoteState'
import { priceOfQuoteState } from '@/lib/server/webQuotePrice'

export const RATE_LABELS = {
  pricePerCubicMeter: 'Valor por m³',
  pricePerKilometer: 'Valor por km',
  packing: 'Embalaje',
  disassembly: 'Desarmado',
  assembly: 'Armado',
} as const
export type ReviewRates = Partial<Record<keyof typeof RATE_LABELS, number>>

export function parseReviewRates(raw: unknown): ReviewRates {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Tarifas inválidas')
  const values = raw as Record<string, unknown>
  if (Object.keys(values).some(k => !(k in RATE_LABELS))) throw new Error('Tarifa desconocida')
  const clean: ReviewRates = {}
  for (const key of Object.keys(RATE_LABELS) as Array<keyof ReviewRates>) {
    const value = values[key]
    if (value === undefined || value === null || value === '') continue
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 10_000_000) {
      throw new Error(`${RATE_LABELS[key]} debe ser un valor válido no negativo`)
    }
    clean[key] = Math.round(value)
  }
  return clean
}

export function reviewPrice(state: SavedQuoteState, distanceKm: number, standard: PricingConfig, overrides: ReviewRates) {
  const effective: PricingConfig = {
    ...standard,
    pricePerCubicMeter: overrides.pricePerCubicMeter ?? standard.pricePerCubicMeter,
    pricePerKilometer: overrides.pricePerKilometer ?? standard.pricePerKilometer,
    additionalServices: {
      ...standard.additionalServices,
      packing: overrides.packing ?? standard.additionalServices.packing,
      disassembly: overrides.disassembly ?? standard.additionalServices.disassembly,
      assembly: overrides.assembly ?? standard.additionalServices.assembly,
    },
  }
  const original = priceOfQuoteState(state, distanceKm, standard)
  const reviewed = priceOfQuoteState(state, distanceKm, effective)
  const volume = state.items.reduce((n, x) => n + Math.max(0, Number(x.volume) || 0) * Math.max(1, Number(x.quantity) || 1), 0)
  const services = state.additionalServices
  const components = {
    base: effective.basePrice,
    volumeM3: volume,
    rateM3: effective.pricePerCubicMeter,
    subtotalVolume: volume * effective.pricePerCubicMeter,
    distanceKm,
    chargeableKm: Math.max(0, distanceKm - effective.freeKilometers),
    rateKm: effective.pricePerKilometer,
    subtotalDistance: Math.max(0, distanceKm - effective.freeKilometers) * effective.pricePerKilometer,
    packing: services.packing ? effective.additionalServices.packing : 0,
    disassembly: services.disassembly ? effective.additionalServices.disassembly : 0,
    assembly: services.assembly ? effective.additionalServices.assembly : 0,
  }
  // El resto conserva recargos de piso, cuadrilla, fechas, descuentos y embalaje por ítem.
  const other = reviewed - (components.base + components.subtotalVolume + components.subtotalDistance
    + components.packing + components.disassembly + components.assembly)
  return { original, reviewed, components: { ...components, other }, rates: effective }
}
