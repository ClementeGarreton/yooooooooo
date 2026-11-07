/**
 * Número escrito a la chilena: «39.500,25», «2.500», «2,5» o «2.5». El punto es de miles solo
 * si separa grupos de tres dígitos («2.500», «1.234.567»); si no, es decimal («2.5», «39500.5»).
 * Devuelve NaN si no es un número.
 */
export function parseChileNumber(raw: unknown): number {
  const text = String(raw ?? '').trim().replace(/\s/g, '')
  if (!text) return NaN
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(text)) return Number(text.replace(/\./g, '').replace(',', '.'))
  if (text.includes(',') && text.includes('.')) return NaN
  return Number(text.replace(',', '.'))
}
