/** Contrato de atención aprobado por Tommy (2026-11-07).
 * Los seis grupos se presentan al cliente; los demás campos internos no se le exigen.
 * Este módulo es deliberadamente puro para que sus reglas puedan probarse sin DB ni IA.
 */
import type { QuoteSessionState } from '../quoteSession'

export type TommyAnswer = 'escaleras' | 'acarreo' | 'embalaje'
export const TOMMY_SIX = ['direcciones', 'articulos', 'fecha', 'escaleras', 'acarreo', 'embalaje'] as const
export type TommyField = typeof TOMMY_SIX[number]

export const TOMMY_WELCOME = [
  '¡Hola! 👋 Bienvenido/a a Yo Me Encargo 🚚',
  '', 'Responde con un número:',
  '1) Cotizar',
  '2) Seguimiento de un servicio',
  '3) Proveedores, solicitudes especiales o hablar con un ejecutivo',
].join('\n')

export const TOMMY_QUOTE_START = [
  '¡Hola! 👋 Para cotizar tu flete o mudanza, por favor envíanos esta información:',
  '',
  '1) Direcciones de origen y destino: calle, número, comuna y número de departamento si corresponde.',
  '2) Lista de artículos a trasladar.',
  '3) Fecha del flete o mudanza.',
  '4) Escaleras: indícanos qué artículos hay que subir o bajar por escalera, cuántos pisos y si es en el origen, el destino o ambos. Si no hay, responde No.',
  '5) Distancia de carga: ¿hay que caminar un tramo largo desde el camión hasta el lugar de carga o descarga? (Sí / No)',
  '6) Embalaje: ¿necesitas que embalemos algo? Si es así, indícanos qué artículos.',
  '',
  'Copia este mensaje y cámbiale las respuestas para contestar más fácil y rápido.',
  '¡Gracias! Con esto te enviamos tu cotización a la brevedad 🚚',
].join('\n')

export const TOMMY_FOLLOWUP = [
  'Perfecto 🙌 Para revisar tu servicio, envíanos:',
  '- Correo con el que hiciste la reserva',
  '- Número de teléfono',
  '- Qué necesitas',
  '',
  'Mientras más antecedentes nos des sobre tu caso, más rápido podremos darte seguimiento o soporte. Te contactaremos dentro de poco.',
].join('\n')

export const TOMMY_EXECUTIVE = [
  'Perfecto 🙌 Para ayudarte, envíanos:',
  '- Correo o número de contacto',
  '- Breve detalle de lo que necesitas y los antecedentes de tu caso, así agilizamos tu proceso',
  '',
  'Un ejecutivo te contactará a la brevedad.',
].join('\n')

const labels: Record<TommyField, string> = {
  direcciones: 'Direcciones de origen y destino (calle, número y comuna; departamento si corresponde)',
  articulos: 'Lista de artículos con cantidades',
  fecha: 'Fecha del flete o mudanza',
  escaleras: 'Escaleras: artículos, pisos y si corresponde a origen, destino o ambos (o indica No)',
  acarreo: 'Distancia de carga: ¿hay que caminar un tramo largo desde el camión? (Sí/No)',
  embalaje: 'Embalaje: ¿qué artículos debemos embalar? (o indica No)',
}

export function tommyMissing(state: QuoteSessionState): TommyField[] {
  const marked = new Set(state.intake?.tommyAnswers || [])
  const a = (side: QuoteSessionState['origin']) => Boolean(
    side.address.street?.trim() && side.address.number?.trim() && side.address.commune?.trim()
  )
  const result: TommyField[] = []
  if (!a(state.origin) || !a(state.destination)) result.push('direcciones')
  if (!state.items.length || state.pendingInventory.length ||
      (state.inventoryPhotos || []).some(photo => photo.status !== 'done')) result.push('articulos')
  if (!state.schedule.date) result.push('fecha')
  for (const name of ['escaleras', 'acarreo', 'embalaje'] as const) {
    if (!marked.has(name)) result.push(name)
  }
  return result
}

export function tommyPendingMessage(state: QuoteSessionState): string | null {
  const missing = tommyMissing(state)
  if (!missing.length) return null
  return [
    '¡Gracias por la información! 🙌 Para enviarte el presupuesto solo nos falta:',
    '',
    ...missing.map(name => `- ${labels[name]}`),
    '',
    'Copia este mensaje y cambia las respuestas para responder más fácil y rápido.',
    'Apenas nos respondas, te enviamos tu cotización 🚚',
  ].join('\n')
}

const removeAccents = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
const normalizeValue = (value: string) => removeAccents(value.replace(/\*/g, '').trim())
const negative = (value: string) => /^(no(?:\b|[,.!])|ningun[oa]?\b|sin\b|no necesito\b)/.test(normalizeValue(value))
const affirmative = (value: string) => /^(si\b|hay\b|necesito\b|se requiere\b|con\b)/.test(normalizeValue(value))

/** No marcar "respondido" por copiar la pregunta sin completarla. */
export function applyTommyAnswers(state: QuoteSessionState, message: string): QuoteSessionState {
  if (!state.intake) return state
  const next = structuredClone(state)
  const answered = new Set(next.intake!.tommyAnswers || [])
  const details = { ...(next.intake!.tommyDetails || {}) }
  const raw = message.trim()
  if (/^(no a todo|todo no|todos no)[.!\s]*$/i.test(removeAccents(raw))) {
    for (const field of ['escaleras', 'acarreo', 'embalaje'] as const) {
      answered.add(field); details[field] = 'No'
    }
    next.additionalServices.packing = false
    if (!next.intake!.serviceAnswers.includes('packing')) next.intake!.serviceAnswers.push('packing')
  }
  const lines = raw.replace(/\r/g, '').split('\n')
  for (const line of lines) {
    const match = /^\s*(?:(4|5|6)\s*[).:-]\s*)?(escaleras?|distancia de carga|acarreo|embalaje|embalar)\s*:\s*(.*?)\s*$/i.exec(line)
    if (!match) continue
    const key = match[1] === '4' || /escalera/i.test(match[2]) ? 'escaleras'
      : match[1] === '5' || /distancia de carga|acarreo/i.test(match[2]) ? 'acarreo' : 'embalaje'
    const value = match[3]
    if (!value || /^[¿?]/.test(value.trim()) || /^(indicanos|hay que|necesitas que|necesitas|que articulos|si es asi)/.test(normalizeValue(value))) continue
    const isNo = negative(value)
    const isYes = affirmative(value)
    if (key === 'escaleras') {
      // Un simple "sí" no responde qué, dónde ni cuántos pisos.
      const informative = /(origen|destino|ambos)\b/i.test(value) && /\b\d+(?:er|do|°|º)?\s*(?:pisos?|plantas?)\b/i.test(value) && /(cama|cajas?|sof[aá]|sill[oó]n|mesa|muebles?|televisor|lavadora|refrigerador|electrodom|art[ií]culos?|todos?|todo)/i.test(value)
      if (isNo || informative) { answered.add(key); details.escaleras = value }
      else if (isYes) answered.delete(key)
    }
    if (key === 'acarreo') {
      if (isNo || isYes || /\b\d+\s*(?:m|metros?)\b/i.test(value)) { answered.add(key); details.acarreo = value }
      else answered.delete(key)
    }
    if (key === 'embalaje') {
      const withObjects = /(solo|cajas?|vajilla|ropa|muebles?|cama|televis|fr[aá]gil|electrodom|loza|platos?|refrigerador|art[ií]culos?)/i.test(value)
      if (isNo || withObjects) {
        answered.add(key); details.embalaje = value
        next.additionalServices.packing = !isNo
        if (!next.intake!.serviceAnswers.includes('packing')) next.intake!.serviceAnswers.push('packing')
        if (!isNo) {
          const note = `EMBALAJE: ${value}`
          if (!next.additionalServices.observations.includes(note)) {
            next.additionalServices.observations = [next.additionalServices.observations === '__pending__' ? '' : next.additionalServices.observations, note].filter(Boolean).join('\n')
          }
        }
      } else if (isYes) answered.delete(key)
    }
  }
  // Declaraciones naturales inequívocas; no inferir a qué inmueble corresponden números sueltos.
  const plain = removeAccents(raw)
  if (!answered.has('escaleras') && /\b(sin escaleras|no (?:se |hay )?(?:usa[n]? |requiere[n]? )?escaleras)\b/.test(plain)) {
    answered.add('escaleras'); details.escaleras = raw
  }
  if (!answered.has('acarreo') && /\b(sin acarreo|no hay (?:distancia de carga|acarreo)|camion (?:en|a) la puerta)\b/.test(plain)) {
    answered.add('acarreo'); details.acarreo = raw
  }
  if (!answered.has('embalaje') && /\b(sin embalaje|no (?:necesito|quiero|requiero) embalaje)\b/.test(plain)) {
    answered.add('embalaje'); details.embalaje = raw
    next.additionalServices.packing = false
    if (!next.intake!.serviceAnswers.includes('packing')) next.intake!.serviceAnswers.push('packing')
  }
  next.intake!.tommyAnswers = [...answered]
  next.intake!.tommyDetails = details
  return next
}

export function tommyCaseSummary(state: QuoteSessionState, estimated: number | null): string {
  const side = (place: QuoteSessionState['origin']) => [place.address.street, place.address.number,
    place.address.commune, place.address.additionalInfo].filter(Boolean).join(', ')
  const fields = state.intake?.tommyDetails || {}
  return [
    `Origen: ${side(state.origin)}`, `Destino: ${side(state.destination)}`,
    `Fecha: ${state.schedule.date || 'Pendiente'}`,
    `Artículos del catálogo: ${state.items.map(i=>`${i.quantity} × ${i.catalogItemId}`).join(', ')}`,
    `Escaleras: ${fields.escaleras || 'No informado'}`,
    `Distancia de carga: ${fields.acarreo || 'No informado'}`,
    `Embalaje: ${fields.embalaje || 'No informado'}`,
    `Precio automático preliminar: ${estimated === null ? 'No calculable automáticamente' : `$${estimated.toLocaleString('es-CL')}`}`,
    'PENDIENTE DE REVISIÓN HUMANA: verificar distancias, volumen, accesos y tarifas antes de enviar precio definitivo.',
  ].join('\n')
}

/** Las líneas numeradas de Tommy no son etiquetas antiguas de la ficha técnica. */
export function isTommyFormReply(text: string): boolean {
  return /^\s*(?:[1-6]\s*[).:-]\s*)?(?:direcciones? de origen y destino|lista de art[ií]culos|fecha del flete(?: o mudanza)?|escaleras?|distancia de carga|acarreo|embalaje)\s*:/im.test(text)
}

/** Evita consumir IA en mensajes que contienen exclusivamente los 3 servicios de Tommy. */
export function isOnlyTommyServiceAnswers(text: string): boolean {
  const lines = text.trim().split(/\r?\n/).map(line=>line.trim()).filter(Boolean)
  return lines.length > 0 && lines.every(line => /^\s*(?:[456]\s*[).:-]\s*)?(?:escaleras?|distancia de carga|acarreo|embalaje)\s*:\s*\S+/i.test(line))
}
