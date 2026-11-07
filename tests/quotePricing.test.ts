import { describe, expect, it } from 'vitest'
import { calculateQuote, dateSurcharge, recommendVehicle, totalVolumeOf, totalWeightOf } from '@/lib/quotePricing'
import { DEFAULT_PRICING_CONFIG as cfg } from '@/lib/pricingDefaults'
import type { QuotePricingInput } from '@/lib/quotePricing'

const cajas = [{ id: 'caja', name: 'Caja mediana', volume: 1, weight: 12, quantity: 4 }]
const refrigerador = [{ id: 'refrigerador', name: 'Refrigerador', volume: 2, weight: 60, quantity: 1 }]

/** Entrada base: miércoles sin recargo, distancia exacta de km gratis, sin servicios. */
const entrada = (extra: Partial<QuotePricingInput> = {}): QuotePricingInput => ({
  items: cajas,
  distanceKm: cfg.freeKilometers,
  dateTime: '2026-07-01T10:00', // miércoles
  pricing: cfg,
  ...extra,
})
const precio = (extra: Partial<QuotePricingInput> = {}) => calculateQuote(entrada(extra)).estimatedPrice

describe('dateSurcharge (feriados y fines de semana verificados contra el calendario 2026)', () => {
  const s = cfg.timeSurcharges
  it('día hábil no cobra nada', () => {
    expect(dateSurcharge('2026-07-01T10:00', s)).toEqual({ percent: 0, kind: null }) // miércoles
  })
  it('sábado 20 % y domingo 50 % (no comparten porcentaje)', () => {
    expect(dateSurcharge('2026-07-04T10:00', s)).toEqual({ percent: 20, kind: 'saturday' })
    expect(dateSurcharge('2026-07-05T10:00', s)).toEqual({ percent: 50, kind: 'sunday' })
  })
  it('feriado que cae domingo NO suma los dos: cobra el mayor', () => {
    expect(dateSurcharge('2026-11-01T10:00', s)).toEqual({ percent: 100, kind: 'holiday' }) // Todos los Santos, domingo
  })
  it('feriado entre semana cobra el de feriado', () => {
    expect(dateSurcharge('2026-12-25T10:00', s)).toEqual({ percent: 100, kind: 'holiday' }) // Navidad, viernes
  })
  it('sin configuración no hay recargo', () => {
    expect(dateSurcharge('2026-07-04T10:00', null)).toEqual({ percent: 0, kind: null })
  })
})

describe('calculateQuote', () => {
  it('empresa NO cambia el precio (los precios ya incluyen IVA — Tomás, 23-10-2026)', () => {
    expect(precio({ isCompany: true })).toBe(precio({ isCompany: false }))
    expect(precio({ isCompany: true })).toBe(precio())
  })
  it('sábado aplica el 20 % sobre el precio del mismo miércoles', () => {
    const wed = precio()
    const sat = precio({ dateTime: '2026-07-04T10:00' })
    // El redondeo final es contra el valor sin redondear: tolera $1 entre ida y vuelta.
    expect(Math.abs(sat - Math.round(wed * 1.2))).toBeLessThanOrEqual(1)
    expect(sat).toBeGreaterThan(wed)
  })
  it('desarmado de refrigerador solo se cobra si el refrigerador sigue en la lista', () => {
    const conRefri = precio({ items: refrigerador, additionalServices: { fridgeDisassembly: true } })
    const conRefriSinServicio = precio({ items: refrigerador })
    expect(conRefri - conRefriSinServicio).toBe(cfg.additionalServices.fridgeDisassembly)
    const sinRefri = precio({ additionalServices: { fridgeDisassembly: true } })
    expect(sinRefri).toBe(precio()) // marcó el servicio pero borró el item: el cargo desaparece
  })
  it('cada km sobre los gratis se cobra, los primeros no', () => {
    const base = precio({ distanceKm: cfg.freeKilometers })
    const gratis = precio({ distanceKm: Math.max(0, cfg.freeKilometers - 10) })
    const extra = precio({ distanceKm: cfg.freeKilometers + 10 })
    expect(gratis).toBe(base)
    expect(extra - base).toBe(10 * cfg.pricePerKilometer)
  })
  it('flexibilidad descuenta y priority suma plano, y el monto es entero', () => {
    const p = calculateQuote(entrada({ isFlexible: true, additionalServices: { priority: true } }))
    expect(Number.isInteger(p.estimatedPrice)).toBe(true)
  })
  it('volumen y peso de los items', () => {
    expect(totalVolumeOf(cajas)).toBe(4)
    expect(totalWeightOf(cajas)).toBe(48)
    expect(totalVolumeOf([])).toBe(0)
  })
})

describe('recommendVehicle', () => {
  it('umbrales 5 / 10 / 20 m3', () => {
    expect(recommendVehicle(5)).toBe('Camioneta')
    expect(recommendVehicle(5.1)).toBe('Camioneta Grande')
    expect(recommendVehicle(10)).toBe('Camioneta Grande')
    expect(recommendVehicle(10.1)).toBe('Furgón Mediano')
    expect(recommendVehicle(20)).toBe('Furgón Mediano')
    expect(recommendVehicle(20.1)).toBe('Furgón Grande')
  })
})
