/** Reconoce respuestas naturales a BOLETA/FACTURA sin alterar precios ni pedir IA. */
export type TaxDocumentChoice = 'boleta' | 'factura'

export function parseTaxDocumentChoice(text: string): TaxDocumentChoice | null {
  const value = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  const boleta = /\bboleta\b/.test(value)
  const factura = /\bfactura\b/.test(value)
  if (!boleta && !factura) return null

  const negated = (kind: TaxDocumentChoice): boolean => new RegExp(
    `\\b(?:no\\s+(?:quiero|necesito|deseo|requiero)|sin)\\s+(?:(?:una|la)\\s+)?${kind}\\b`,
  ).test(value)
  if (boleta && factura) {
    if (negated('factura') && !negated('boleta')) return 'boleta'
    if (negated('boleta') && !negated('factura')) return 'factura'
    const preferred = /\b(?:prefiero|necesito|quiero|solicito|solo|solamente)\s+(?:(?:una|la)\s+)?(boleta|factura)\b/.exec(value)
    return preferred ? preferred[1] as TaxDocumentChoice : null
  }
  if (boleta) return negated('boleta') ? null : 'boleta'
  return negated('factura') ? null : 'factura'
}
