/**
 * DOCUMENTO TRIBUTARIO E IVA de una reserva.
 *
 * Un documento por reserva (boleta, factura o sin documento); `null` = todavía nadie lo
 * definió. Las reservas anteriores al 24-sep-2026 quedan así a propósito: no se deduce
 * de la ficha, porque «es empresa» no garantiza que se haya emitido factura.
 *
 * El precio de una reserva YA INCLUYE el IVA (el cotizador le suma el 19% a las empresas
 * y a las personas se les cobra el total con IVA incluido, como en toda boleta). Por eso
 * el desglose separa el total, no le agrega nada: $119.000 = $100.000 neto + $19.000 IVA.
 * Sin documento no se desglosa: no hay IVA declarado que mostrar.
 */

export const IVA_RATE = 0.19

export type TaxDocument = 'boleta' | 'factura' | 'sin_documento'

export const TAX_DOCUMENT_OPTIONS: Array<{ value: TaxDocument; label: string }> = [
  { value: 'boleta', label: 'Boleta' },
  { value: 'factura', label: 'Factura' },
  { value: 'sin_documento', label: 'Sin documento' },
]

const LABELS: Record<TaxDocument, string> = {
  boleta: 'Boleta',
  factura: 'Factura',
  sin_documento: 'Sin documento',
}

/** Valor válido o `null` (sin definir). Cualquier otra cosa se descarta. */
export function normalizeTaxDocument(value: unknown): TaxDocument | null {
  return value === 'boleta' || value === 'factura' || value === 'sin_documento' ? value : null
}

/** «Boleta», «Factura», «Sin documento» o «Sin definir». */
export function taxDocumentLabel(value: unknown): string {
  const doc = normalizeTaxDocument(value)
  return doc ? LABELS[doc] : 'Sin definir'
}

export interface IvaBreakdown {
  neto: number
  iva: number
}

/**
 * Neto e IVA de un monto que ya trae el IVA incluido. `null` cuando no corresponde
 * desglosar: sin documento, sin definir o sin monto.
 *
 * El IVA se obtiene como la DIFERENCIA con el neto redondeado, así neto + IVA da siempre
 * exactamente el total (redondear los dos por separado puede descuadrar en $1).
 */
export function ivaBreakdown(total: unknown, document: unknown): IvaBreakdown | null {
  const doc = normalizeTaxDocument(document)
  const monto = Math.round(Number(total) || 0)
  if ((doc !== 'boleta' && doc !== 'factura') || monto <= 0) return null
  const neto = Math.round(monto / (1 + IVA_RATE))
  return { neto, iva: monto - neto }
}

/**
 * ¿El error de Supabase es porque falta la columna? Pasa mientras no se corra
 * add_booking_tax_document.sql: 42703 viene de Postgres y PGRST204 del caché de PostgREST.
 */
export function isMissingColumnError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  return (
    error.code === '42703' ||
    error.code === 'PGRST204' ||
    /tax_document/i.test(String(error.message || ''))
  )
}
