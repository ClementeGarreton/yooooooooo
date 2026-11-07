// Paradas intermedias de una cotización: origen → parada 1 → … → destino.
//
// Vive en su propio archivo porque las mismas paradas se muestran en cinco lugares
// (resumen del cotizador, PDF con precios, orden de trabajo, link del chofer y panel) y
// tienen que leerse igual en todos. Además llegan de la base como JSON sin tipar, así que
// hay un único punto donde se normalizan.

export interface QuoteStop {
  street: string
  number: string
  commune: string
  region?: string
  additionalInfo?: string
  /** Qué hay que hacer en esta parada: cargar, dejar, retirar. */
  note?: string
}

/**
 * Convierte lo que venga de la base (JSONB, puede ser null, string o cualquier cosa) en
 * una lista de paradas usable. Descarta las que no tengan al menos calle y comuna: una
 * parada sin dirección no se puede ni mostrar ni recorrer.
 */
export function normalizeStops(raw: unknown): QuoteStop[] {
  let value = raw
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      return []
    }
  }
  if (!Array.isArray(value)) return []

  return value
    .filter((s): s is Record<string, unknown> => Boolean(s) && typeof s === 'object')
    .map((s) => ({
      street: String(s.street || '').trim(),
      number: String(s.number || '').trim(),
      commune: String(s.commune || '').trim(),
      region: s.region ? String(s.region).trim() : undefined,
      additionalInfo: s.additionalInfo ? String(s.additionalInfo).trim() : undefined,
      note: s.note ? String(s.note).trim() : undefined,
    }))
    .filter((s) => s.street && s.commune)
}

/** Dirección de una parada en una línea. */
export function formatStopAddress(stop: QuoteStop): string {
  const partes = [
    [stop.street, stop.number].filter(Boolean).join(' '),
    stop.commune,
  ].filter(Boolean)
  const base = partes.join(', ')
  return stop.additionalInfo ? `${base} (${stop.additionalInfo})` : base
}

/** Resumen corto para una línea sola: "2 paradas: Providencia, Ñuñoa". */
export function summarizeStops(stops: QuoteStop[]): string {
  if (stops.length === 0) return ''
  const comunas = stops.map((s) => s.commune).filter(Boolean)
  const etiqueta = stops.length === 1 ? '1 parada' : `${stops.length} paradas`
  return comunas.length ? `${etiqueta}: ${comunas.join(', ')}` : etiqueta
}
