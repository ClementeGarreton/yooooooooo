import { supabaseAdmin } from '@/lib/supabase'

/**
 * Helpers de atribucion para el servidor: extraer los campos de atribucion del body de
 * un request, y persistirlos en `quote_prospects` / `bookings` sin sobrescribir un
 * gclid ya guardado. La columna critica es `gclid` (la que lee el dashboard de Vanlook).
 */

export interface AttributionFields {
  gclid: string | null
  gbraid: string | null
  wbraid: string | null
  utm_source: string | null
  utm_campaign: string | null
}

const EMPTY: AttributionFields = {
  gclid: null,
  gbraid: null,
  wbraid: null,
  utm_source: null,
  utm_campaign: null,
}

const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() ? v.trim() : null

/**
 * Extrae los campos de atribucion del body. Acepta tanto un objeto anidado
 * `body.attribution` (lo que manda el cliente) como campos al nivel superior.
 */
export function pickAttribution(body: any): AttributionFields {
  const a = (body && (body.attribution ?? body)) || {}
  return {
    gclid: str(a.gclid),
    gbraid: str(a.gbraid),
    wbraid: str(a.wbraid),
    utm_source: str(a.utm_source),
    utm_campaign: str(a.utm_campaign),
  }
}

export function hasAttribution(a: AttributionFields): boolean {
  return Boolean(a.gclid || a.gbraid || a.wbraid || a.utm_source || a.utm_campaign)
}

/** El visitor id que manda el cliente (cookie `_vla`) en `body.attribution`. */
export function pickVisitorId(body: any): string | null {
  const a = (body && (body.attribution ?? body)) || {}
  const v = str(a.visitor_id)
  return v && v.length <= 128 ? v : null
}

/**
 * Guarda el visitor id en la cotizacion, solo si aun no tiene (first-touch por fila). Une
 * a la persona con sus visitas aunque no haya llegado por un anuncio: la reserva hereda el
 * origen en el dashboard porque es la misma persona (email/telefono). Best-effort: un
 * fallo aca no frena la cotizacion.
 */
export async function saveProspectVisitorId(prospectId: string, visitorId: string | null): Promise<void> {
  if (!visitorId) return
  const { error } = await supabaseAdmin
    .from('quote_prospects')
    .update({ visitor_id: visitorId })
    .eq('id', prospectId)
    .is('visitor_id', null)
  if (error) console.error(`[attribution] Error guardando visitor_id en quote_prospects#${prospectId}:`, error)
}

/**
 * Resuelve la atribucion para una reserva. Prioriza lo que trae el cliente; si no trae
 * nada, hereda la del `quote_prospects` correspondiente (mismo quote_id) — el caso de
 * una reserva creada a partir de una cotizacion previa.
 */
export async function resolveBookingAttribution(
  body: any,
  quoteId?: string | null
): Promise<AttributionFields> {
  const fromClient = pickAttribution(body)
  if (hasAttribution(fromClient)) return fromClient

  if (quoteId) {
    const { data } = await supabaseAdmin
      .from('quote_prospects')
      .select('gclid, gbraid, wbraid, utm_source, utm_campaign')
      .eq('quote_id', quoteId)
      .not('gclid', 'is', null)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (data) {
      const inherited = pickAttribution(data)
      if (hasAttribution(inherited)) return inherited
    }
  }

  return { ...EMPTY }
}

/**
 * Backfillea las columnas de atribucion de una fila ya existente SOLO donde estan
 * vacias (first-touch por fila: nunca sobrescribe un valor ya guardado). Devuelve
 * silenciosamente si no hay nada que rellenar. `existing` son los valores actuales de
 * la fila (los que ya se hayan leido); si no se pasan, se asume todo null.
 */
export async function backfillAttribution(
  table: 'quote_prospects' | 'bookings',
  id: string,
  incoming: AttributionFields,
  existing?: Partial<AttributionFields> | null
): Promise<void> {
  if (!hasAttribution(incoming)) return

  const patch: Partial<AttributionFields> = {}
  ;(Object.keys(EMPTY) as (keyof AttributionFields)[]).forEach((k) => {
    if (incoming[k] && !existing?.[k]) patch[k] = incoming[k]
  })

  if (Object.keys(patch).length === 0) return

  const { error } = await supabaseAdmin.from(table).update(patch).eq('id', id)
  if (error) {
    console.error(`[attribution] Error backfilling ${table}#${id}:`, error)
  }
}
