import { describe, expect, it } from 'vitest'
import { calculateQuote } from '../src/lib/quotePricing'
import { DEFAULT_PRICING_CONFIG } from '../src/lib/pricingDefaults'

const items = [
  { id: 'refrigerador', name: 'Refrigerador', quantity: 2, volume: 2, weight: 95 },
  { id: 'escritorio', name: 'Escritorio', quantity: 2, volume: 1.2, weight: 25 },
  { id: 'cama', name: 'Cama', quantity: 2, volume: 1.7, weight: 32 },
]
const pricing = {
  ...DEFAULT_PRICING_CONFIG,
  additionalServices: { ...DEFAULT_PRICING_CONFIG.additionalServices, packing: 20000 },
}
function quote(packing: boolean, hasElevator: boolean, flexible = false) {
  return calculateQuote({
    items,
    origin: { floor: 5, hasElevator },
    destination: { floor: 1, hasElevator: false },
    distanceKm: 3.32,
    dateTime: '2026-11-16T10:00:00',
    isFlexible: flexible,
    additionalServices: { packing },
    pricing,
  })
}
describe('Desglose auditado de cotizaciones de WhatsApp', () => {
  it('suma exactamente el precio estimado, incluido redondeo', () => {
    for (const flexible of [false, true]) for (const packing of [false, true]) {
      const result = quote(packing, false, flexible)
      expect(result.priceBreakdown.reduce((sum, item) => sum + item.amount, 0)).toBe(result.estimatedPrice)
    }
  })
  it('embalaje global de los dos escritorios aparece como cargo separado', () => {
    const withPacking = quote(true, true)
    const withoutPacking = quote(false, true)
    expect(withPacking.estimatedPrice - withoutPacking.estimatedPrice).toBe(20000)
    expect(withPacking.priceBreakdown.find((item) => item.key === 'packing')?.amount).toBe(20000)
  })
  it('expone origen y destino con recargos de escaleras por separado', () => {
    const result = quote(false, false)
    expect(result.priceBreakdown.find((item) => item.key === 'stairs_origin')?.amount).toBeGreaterThan(0)
    expect(result.priceBreakdown.find((item) => item.key === 'stairs_destination')?.amount).toBeGreaterThan(0)
  })
})
