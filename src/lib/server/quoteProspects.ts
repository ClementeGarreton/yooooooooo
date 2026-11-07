/**
 * GUARDAR UNA COTIZACIÓN COMO PROSPECTO — una sola función para la web y el panel.
 *
 * Vivía dentro de `/api/prospects/create`. El cotizador interno del panel necesita
 * exactamente lo mismo (misma identidad por email, mismo `lead_key`, mismos campos), con
 * una sola diferencia: puede fijar un precio final distinto del calculado. Si cada ruta
 * tuviera su upsert, la ficha de una misma persona dependería de quién la cargó.
 *
 * Los precios:
 *  - `total_price` es SIEMPRE lo que calculó el cotizador (el «precio calculado»).
 *  - `adjusted_price` es el precio final cuando alguien lo cambió a mano; `null` si no.
 *  Todo lo que le habla al cliente ya lee `adjusted_price ?? total_price` (secuencia de
 *  correos, PDF del panel, reenvío de la cotización), así que no hizo falta una columna
 *  nueva para el precio final.
 */

import crypto from 'crypto'
import { supabaseAdmin } from '@/lib/supabase'
import {
  buildCustomerIdentityIndex,
  normalizeCustomerEmail,
  resolveIncomingCustomerSource,
} from '@/lib/prospectSource'
import { normalizeStops } from '@/lib/stops'
import { sanitizeQuoteState } from '@/lib/quoteState'

export class QuoteProspectInputError extends Error {}

export interface UpsertQuoteProspectResult {
  prospect: Record<string, any>
  existingCustomer: boolean
  customerOrigin: string
}

/**
 * Lo que imprime el PDF de la cotización. Si cambia algo de esto, el PDF guardado quedó viejo.
 * Normaliza lo que la base devuelve distinto de como llegó: numéricos como texto y con dos
 * decimales, hora con segundos, llaves de JSON en otro orden.
 */
const PDF_NUMBER_FIELDS = ['total_price', 'total_volume', 'total_weight', 'total_distance', 'origin_floor', 'destination_floor', 'origin_parking_distance', 'destination_parking_distance']
const PDF_TEXT_FIELDS = ['name', 'email', 'phone', 'company_name', 'company_rut', 'origin_address', 'destination_address', 'visit_address', 'recommended_vehicle']
const PDF_JSON_FIELDS = ['stops', 'items_summary', 'additional_services', 'origin_has_elevator', 'destination_has_elevator']

const canonicalJson = (value: unknown): string =>
  JSON.stringify(value ?? null, (_key, val) =>
    val && typeof val === 'object' && !Array.isArray(val)
      ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => a.localeCompare(b)))
      : val
  )

function pdfFingerprint(row: Record<string, any>): string {
  const numbers = PDF_NUMBER_FIELDS.map((field) => {
    const value = row[field]
    return value === null || value === undefined || value === '' ? null : Number(Number(value).toFixed(2))
  })
  const texts = PDF_TEXT_FIELDS.map((field) => String(row[field] ?? '').trim())
  const when = [String(row.scheduled_date ?? '').slice(0, 10), String(row.scheduled_time ?? '').slice(0, 5)]
  return canonicalJson([numbers, texts, when, PDF_JSON_FIELDS.map((field) => row[field] ?? null)])
}

/** ¿Lo que se va a guardar imprimiría otro PDF que el de la fila actual? */
export function pdfContentChanged(existing: Record<string, any>, next: Record<string, any>): boolean {
  // El precio final del panel también se imprime. La web no manda `adjusted_price`: no lo compara.
  if (next.adjusted_price !== undefined && Number(existing.adjusted_price ?? 0) !== Number(next.adjusted_price ?? 0)) return true
  return pdfFingerprint(existing) !== pdfFingerprint(next)
}

export async function upsertQuoteProspect(
  body: Record<string, any>,
  /**
   * Solo el panel lo pasa. `adjusted_price` se escribe SIEMPRE que venga (también `null`),
   * para que una cotización nueva sin ajuste no herede el precio ajustado de una anterior
   * con el mismo `lead_key`. La web no lo pasa y nunca toca esas columnas.
   */
  adjustment?: { adjusted_price: number | null; adjustment_comment: string | null },
  /**
   * Solo el panel: `prospectId` = se está EDITANDO esa cotización (sus artículos, por
   * ejemplo). Se actualiza esa fila por su id en vez de buscarla por `lead_key`, que cambia
   * si cambian la fecha o las direcciones y crearía una cotización nueva.
   */
  options?: { prospectId?: string }
): Promise<UpsertQuoteProspectResult> {
  const {
    source = 'web',
    quote_id,
    name,
    email,
    phone,
    is_company = false,
    company_name,
    company_rut,
    origin_address,
    stops,
    destination_address,
    origin_floor,
    origin_has_elevator,
    origin_parking_distance,
    destination_floor,
    destination_has_elevator,
    destination_parking_distance,
    visit_address,
    scheduled_date,
    scheduled_time,
    total_price,
    original_price,
    is_flexible = false,
    recommended_vehicle,
    total_volume,
    total_weight,
    total_distance,
    items_summary,
    additional_services,
    quote_state,
  } = body

  const normalizedEmail = normalizeCustomerEmail(email)

  if (!name || !normalizedEmail || !phone) {
    throw new QuoteProspectInputError('Se requiere al menos nombre, email y teléfono')
  }

  // Una nueva cotización sigue siendo una oportunidad propia, pero la persona se
  // reconoce por email. Así hereda su clasificación/frecuencia y nunca aparece como
  // un segundo cliente en las vistas consolidadas.
  const [identityResult, bookingResult] = await Promise.all([
    supabaseAdmin
      .from('quote_prospects')
      .select('email, source, status, is_frequent, converted_booking_id, lead_key')
      .eq('email', normalizedEmail),
    supabaseAdmin.from('bookings').select('id').ilike('client_email', normalizedEmail).limit(1),
  ])

  const { data: previousRows, error: identityError } = identityResult

  if (identityError) {
    console.error('[Prospects] Error resolving customer identity:', identityError)
  }
  if (bookingResult.error) {
    console.error('[Prospects] Error checking existing booking email:', bookingResult.error)
  }

  const existingIdentity = buildCustomerIdentityIndex(previousRows || []).get(normalizedEmail)
  const effectiveSource = resolveIncomingCustomerSource(source, existingIdentity)

  // Generar lead_key para upsert (evitar duplicados de la misma cotización).
  //
  // Lleva el quote_id: identifica la sesión del cotizador, que guarda varias veces la misma
  // cotización (al llegar al resumen, al pedirla por correo, al ir a pagar). Sin él, una
  // cotización NUEVA con el mismo correo, fecha y direcciones que una vieja (el cotizador
  // recuerda los datos de la vez anterior) caía encima de esa fila: conservaba su código y
  // su fecha de creación y quedaba enterrada meses atrás en Prospectos, u oculta si la
  // vieja estaba convertida. Pasó con la de Tomás del 27-10, guardada sobre COT-000783 del 22-08.
  const rawKey = `${normalizedEmail}|${scheduled_date || ''}|${origin_address || ''}|${destination_address || ''}|${visit_address || ''}${quote_id ? `|${quote_id}` : ''}`
  const leadKey = crypto.createHash('md5').update(rawKey).digest('hex')

  const prospectData = {
    source: effectiveSource,
    quote_id: quote_id || null,
    name,
    email: normalizedEmail,
    phone,
    is_frequent: Boolean(existingIdentity?.isFrequent),
    is_company,
    company_name: is_company ? company_name : null,
    company_rut: is_company ? company_rut : null,
    origin_address: origin_address || null,
    // Paradas intermedias. `normalizeStops` descarta las incompletas: una parada sin
    // dirección no se puede recorrer ni mostrar, y guardarla ensucia la ruta.
    stops: normalizeStops(stops).length ? normalizeStops(stops) : null,
    destination_address: destination_address || null,
    origin_floor: origin_floor ?? null,
    origin_has_elevator: origin_has_elevator ?? null,
    origin_parking_distance: origin_parking_distance ?? null,
    destination_floor: destination_floor ?? null,
    destination_has_elevator: destination_has_elevator ?? null,
    destination_parking_distance: destination_parking_distance ?? null,
    visit_address: visit_address || null,
    scheduled_date: scheduled_date || null,
    scheduled_time: scheduled_time || null,
    total_price: total_price || null,
    original_price: original_price || null,
    is_flexible,
    recommended_vehicle: recommended_vehicle || null,
    total_volume: total_volume || null,
    total_weight: total_weight || null,
    total_distance: total_distance || null,
    items_summary: items_summary || null,
    additional_services: additional_services || null,
    lead_key: leadKey,
    updated_at: new Date().toISOString(),
    ...(adjustment
      ? {
          adjusted_price: adjustment.adjusted_price,
          adjustment_comment: adjustment.adjustment_comment,
        }
      : {}),
  }

  // Upsert: si ya existe un lead con la misma key, actualizar en vez de duplicar. Editando
  // una cotización del panel, se actualiza esa misma fila.
  // Editando, la fila conserva su lead_key: recalcularlo con la fecha o dirección nuevas puede
  // chocar con otra cotización del mismo cliente (lead_key es único) y la edición se perdía.
  const upsert = (row: Record<string, any>) =>
    options?.prospectId
      ? supabaseAdmin
          .from('quote_prospects')
          .update(Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'lead_key')))
          .eq('id', options.prospectId)
          .select()
          .single()
      : supabaseAdmin
          .from('quote_prospects')
          .upsert(row, {
            onConflict: 'lead_key',
            ignoreDuplicates: false,
          })
          .select()
          .single()

  // Si la cotización cambió, su PDF ya no vale: se descarta para que el resumen suba uno nuevo y
  // ningún correo mande el anterior. Eduardo Torrealba (COT-001832, 29-10-2026) quitó artículos y
  // el correo decía $666.458 con un PDF de $752.608; el 30-10 eran 108 cotizaciones con precios
  // distintos desde septiembre.
  const { data: existingRow, error: existingError } = await (options?.prospectId
    ? supabaseAdmin.from('quote_prospects').select('*').eq('id', options.prospectId).maybeSingle()
    : supabaseAdmin.from('quote_prospects').select('*').eq('lead_key', leadKey).maybeSingle())
  if (existingError) console.error('[Prospects] Error leyendo la cotización actual:', existingError)
  if (existingRow?.pdf_url && pdfContentChanged(existingRow, prospectData)) {
    Object.assign(prospectData, { pdf_url: null, pdf_generated_at: null })
  }

  // El estado completo del cotizador va en `quote_state` (migración `add_quote_state.sql`).
  // Guardar la cotización no puede depender de esa columna: si todavía no existe, se guarda
  // sin ella, igual que antes.
  const quoteState = sanitizeQuoteState(quote_state)
  let { data: prospect, error: upsertError } = await upsert(
    quoteState ? { ...prospectData, quote_state: quoteState } : prospectData
  )
  if (upsertError && quoteState && /quote_state/.test(`${upsertError.message} ${upsertError.details || ''}`)) {
    ;({ data: prospect, error: upsertError } = await upsert(prospectData))
  }

  if (upsertError || !prospect) {
    console.error('[Prospects] Error upserting prospect:', upsertError)
    throw new Error('Error al guardar el prospecto')
  }

  return {
    prospect,
    existingCustomer: Boolean(existingIdentity?.isCustomer) || Boolean(bookingResult.data?.length),
    customerOrigin: existingIdentity?.origin || effectiveSource,
  }
}
