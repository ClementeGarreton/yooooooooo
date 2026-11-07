import { describe, expect, it } from 'vitest'
import { isMissingColumnError, ivaBreakdown, normalizeTaxDocument, taxDocumentLabel } from '@/lib/taxDocument'

describe('normalizeTaxDocument / taxDocumentLabel', () => {
  it('pasa solo los tres valores conocidos', () => {
    expect(normalizeTaxDocument('boleta')).toBe('boleta')
    expect(normalizeTaxDocument('factura')).toBe('factura')
    expect(normalizeTaxDocument('sin_documento')).toBe('sin_documento')
    expect(normalizeTaxDocument('FACTURA')).toBeNull()
    expect(normalizeTaxDocument(null)).toBeNull()
    expect(normalizeTaxDocument(undefined)).toBeNull()
  })
  it('etiqueta en español, con «Sin definir» de reserva', () => {
    expect(taxDocumentLabel('boleta')).toBe('Boleta')
    expect(taxDocumentLabel('cualquiera')).toBe('Sin definir')
  })
})

describe('ivaBreakdown', () => {
  it('desglose exacto cuando el monto redondo lo permite', () => {
    expect(ivaBreakdown(119000, 'factura')).toEqual({ neto: 100000, iva: 19000 })
  })
  it('el iva sale de la diferencia: neto + iva = total siempre', () => {
    expect(ivaBreakdown(100, 'boleta')).toEqual({ neto: 84, iva: 16 })
    for (let total = 1; total <= 20000; total++) {
      const d = ivaBreakdown(total, 'boleta')
      expect(d).not.toBeNull()
      expect(d!.neto + d!.iva).toBe(total)
      // El neto deriva del bruto con 19 %: a lo sumo $1 de distancia al redondear.
      expect(Math.abs(Math.round(d!.neto * 1.19) - total)).toBeLessThanOrEqual(1)
    }
  })
  it('null cuando no corresponde desglosar', () => {
    expect(ivaBreakdown(119000, 'sin_documento')).toBeNull()
    expect(ivaBreakdown(119000, null)).toBeNull()
    expect(ivaBreakdown(0, 'boleta')).toBeNull()
    expect(ivaBreakdown(-500, 'factura')).toBeNull()
    expect(ivaBreakdown('no-numero', 'boleta')).toBeNull()
  })
})

describe('isMissingColumnError', () => {
  it('reconoce Postgres 42703 y PostgREST PGRST204', () => {
    expect(isMissingColumnError({ code: '42703', message: '' })).toBe(true)
    expect(isMissingColumnError({ code: 'PGRST204', message: '' })).toBe(true)
    expect(isMissingColumnError({ message: 'column bookings.tax_document does not exist' })).toBe(true)
    expect(isMissingColumnError({ code: '23505', message: 'duplicate key' })).toBe(false)
    expect(isMissingColumnError(null)).toBe(false)
  })
})
