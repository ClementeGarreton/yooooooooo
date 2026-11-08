/** Contrato de atención aprobado por Tommy (2026-11-07).
 * Los seis grupos se presentan al cliente; los demás campos internos no se le exigen.
 * Este módulo es deliberadamente puro para que sus reglas puedan probarse sin DB ni IA.
 */
import type { QuoteSessionState } from '../quoteSession'
import { extractTommyDifferential, type DiffField } from './tommyDifferential.ts'

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
  '1) Direcciones de origen y destino: calle, número, comuna y número de departamento si corresponde. | Respuesta:',
  '2) Lista de artículos a trasladar. | Respuesta:',
  '3) Fecha del flete o mudanza. | Respuesta:',
  '4) Acceso por ascensor o escalera: ¿hay ascensor utilizable para los muebles en origen y destino? Si debes subir o bajar muebles por escaleras, indica lugar, cantidad de pisos y cuáles muebles. Si no se requieren escaleras, responde No. | Respuesta:',
  '5) Distancia de carga: ¿hay que caminar un tramo largo desde el camión hasta el lugar de carga o descarga? (Sí / No) | Respuesta:',
  '6) Embalaje: ¿necesitas que embalemos algo? Si es así, indícanos qué artículos. | Respuesta:',
  '',
  'Copia este mensaje y escribe tu respuesta después de «Respuesta:» en cada punto. Si no corresponde, escribe «No».',
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
  escaleras: 'Acceso por ascensor o escalera: ¿hay ascensor utilizable para los muebles en origen y destino? Si hay que utilizar escaleras, indica en cuál lugar, cuántos pisos y qué muebles (o responde No si no se necesitan)',
  acarreo: 'Distancia de carga: ¿hay que caminar un tramo largo desde el camión? (Sí/No)',
  embalaje: 'Embalaje: ¿qué artículos debemos embalar? (o indica No)',
}

const simplifyAccess = (v: string) => v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()

/** «No hay ascensor» significa lo contrario de «no se necesitan escaleras». */
function noStairs(value: string): boolean {
  const v = simplifyAccess(value)
  if (/\b(?:no hay|sin|no tiene|no existe) ascensor\b/.test(v)) return false
  return /^(?:no|no no|no no hay|sin escaleras|ninguno|ninguna|no se (?:usan|requieren|necesitan) escaleras)[.!\s]*$/.test(v) ||
    /\b(?:sin necesidad de escaleras|no hace falta usar escaleras)\b/.test(v)
}

function stairsPendingLabel(state: QuoteSessionState): string {
  const detail = state.intake?.tommyDetails?.escaleras || ''
  const partial = simplifyAccess(detail).match(/\b(\d{1,2})\s*pisos?\s*(?:en|de|del)\s*(?:el\s*)?(origen|destino)\b/)
  const known = partial ? `Ya indicaste ${partial[1]} pisos en ${partial[2]}. ` : ''
  const sides = (['origin','destination'] as const).filter(place => state[place].details.hasElevator === null)
  const question = sides.length === 1
    ? `En ${sides[0] === 'origin' ? 'origen' : 'destino'}, ¿hay ascensor utilizable para los muebles o habrá que moverlos por escaleras?`
    : sides.length === 0
      ? 'Si algún mueble debe subir o bajar por escaleras, ¿cuáles, en qué lugar y cuántos pisos?'
      : '¿Hay ascensor utilizable para trasladar los muebles en origen y destino, o será necesario usar escaleras?'
  return `Acceso por ascensor o escalera: ${known}${question} Si se requieren escaleras, indica qué muebles; de lo contrario, responde No`
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
    if (!marked.has(name) && !(name === 'escaleras' && state.origin.details.hasElevator === true && state.destination.details.hasElevator === true)) result.push(name)
  }
  return result
}

export function tommyPendingMessage(state: QuoteSessionState): string | null {
  const missing = tommyMissing(state)
  if (!missing.length) return null
  return [
    '¡Gracias por la información! 🙌 Para enviarte el presupuesto solo nos falta:',
    '',
    ...missing.map(name => `- ${name === 'escaleras' ? stairsPendingLabel(state) : labels[name]} | Respuesta:`),
    '',
    'Copia este mensaje y completa «Respuesta:» en cada pendiente.',
    'Apenas nos respondas, te enviamos tu cotización 🚚',
  ].join('\n')
}

const removeAccents = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
const normalizeValue = (value: string) => removeAccents(value.replace(/\*/g, '').trim())
const negative = (value: string) => /^(no(?:\b|[,.!])|ningun[oa]?\b|sin\b|no necesito\b)/.test(normalizeValue(value))
const affirmative = (value: string) => /^(si\b|hay\b|necesito\b|se requiere\b|con\b)/.test(normalizeValue(value))

// Incluir la referencia original y TODOS los rótulos de pendientes. No depender
// de que el cliente copie precisamente la última plantilla: puede contestar un
// mensaje anterior después de haber cerrado otras preguntas.
// Mantener compatibilidad con formularios enviados antes de esta corrección.
const OLD_STAIRS_QUESTION = '4) Escaleras: indícanos qué artículos hay que subir o bajar por escalera, cuántos pisos y si es en el origen, el destino o ambos. Si no hay, responde No. | Respuesta:'
const OLD_STAIRS_PENDING = '- Escaleras: artículos, pisos y si corresponde a origen, destino o ambos (o indica No) | Respuesta:'

export const TOMMY_PENDING_REFERENCE = [
  '- ' + labels.direcciones,
  '- ' + labels.articulos,
  '- ' + labels.fecha,
  '- ' + labels.escaleras,
  '- ' + labels.acarreo,
  '- ' + labels.embalaje,
].join('\n')

function references(state?: QuoteSessionState): string[] {
  return [TOMMY_QUOTE_START, TOMMY_PENDING_REFERENCE, OLD_STAIRS_QUESTION, OLD_STAIRS_PENDING, ...(state ? [tommyPendingMessage(state) || ''] : [])]
}

/** Solo el delta, nunca las preguntas que el cliente copió literalmente. */
export function tommyDifferentialResult(message: string, state?: QuoteSessionState) {
  return extractTommyDifferential(message, references(state))
}

export function tommyAnswerOnlyForAI(message: string, state?: QuoteSessionState): string {
  const diff = tommyDifferentialResult(message, state)
  if (!diff.copiedForm) return message.trim()
  const aiLabels: Record<DiffField, string> = {
    direcciones: 'Direcciones origen y destino', articulos: 'Artículos para trasladar',
    fecha: 'Fecha del flete', escaleras: 'Escaleras', acarreo: 'Acarreo', embalaje: 'Embalaje',
  }
  return [
    ...diff.answers.map(answer => `${aiLabels[answer.field]}: ${answer.value}`),
    ...(diff.freeText ? [diff.freeText] : []),
  ].join('\n').trim()
}

/**
 * Aplica únicamente respuestas verificables que hayan cambiado respecto de la
 * referencia. El texto fijo del formulario NO puede completar un campo.
 */
export function applyTommyAnswers(state: QuoteSessionState, message: string): QuoteSessionState {
  if (!state.intake) return state
  const next = structuredClone(state)
  const answered = new Set(next.intake!.tommyAnswers || [])
  const details = { ...(next.intake!.tommyDetails || {}) }
  const raw = message.trim()
  const diff = tommyDifferentialResult(raw, state)
  // Dos respuestas distintas en el mismo mensaje invalidan solo ese campo.
  // No borrar respuestas anteriores por copiar una pregunta sin contestarla.
  for (const field of diff.conflicted) {
    if (['escaleras', 'acarreo', 'embalaje'].includes(field)) {
      answered.delete(field as TommyAnswer)
      delete details[field as TommyAnswer]
    }
  }
  if (/^(no a todo|todo no|todos no)[.!\s]*$/i.test(removeAccents(raw))) {
    for (const field of ['escaleras', 'acarreo', 'embalaje'] as const) {
      answered.add(field); details[field] = 'No'
    }
    next.additionalServices.packing = false
    if (!next.intake!.serviceAnswers.includes('packing')) next.intake!.serviceAnswers.push('packing')
  }
  for (const entry of diff.answers) {
    if (!(['escaleras','acarreo','embalaje'] as string[]).includes(entry.field)) continue
    const key = entry.field as TommyAnswer
    const value = entry.value.trim()
    const isNo = negative(value)
    const isYes = affirmative(value)
    if (key === 'escaleras') {
      // Guardar antecedentes parciales sin dar el campo por completo.
      const old = details.escaleras || ''
      const combined = old && !noStairs(old) && !noStairs(value) ? `${old}; ${value}` : value
      const normalized = simplifyAccess(combined)
      const hasSide = /\b(origen|destino|ambos)\b/.test(normalized)
      const hasFloors = /\b(?:\d+(?:er|ro|do|°|º)?|uno|dos|tres|cuatro|cinco|primer|segundo|tercer)\s*(?:pisos?|plantas?)\b/.test(normalized)
      const hasFurniture = /\b(camas?|cajas?|sofas?|sillones?|mesas?|escritorios?|muebles?|televisores?|lavadoras?|refrigeradores?|articulos?|todos?)\b/.test(normalized)
      const bothElevators = /\b(?:ascensor(?:es)?\s+(?:en\s+)?ambos|ascensor(?:es)?\s+(?:en\s+)?origen y destino|(?:en\s+)?origen y destino\s+(?:(?:con|hay|tienen?)\s+)?ascensor(?:es)?)\b/.test(simplifyAccess(value)) &&
        !/\b(?:sin ascensor|no hay ascensor|no tienen ascensor)\b/.test(simplifyAccess(value))
      const complete = noStairs(value) || bothElevators || (hasSide && hasFloors && hasFurniture) ||
        (next.origin.details.hasElevator === true && next.destination.details.hasElevator === true)
      details.escaleras = noStairs(value) || bothElevators ? value : combined
      if (complete) answered.add(key)
      else answered.delete(key)
    }
    if (key === 'acarreo') {
      // Tommy pidió aclarar en cuál inmueble hay acarreo cuando es afirmativo.
      const informative = /\b(origen|destino|ambos)\b/i.test(value) ||
        /\b\d+(?:[.,]\d+)?\s*(?:metros?|m)\b/i.test(value)
      if (isNo || informative) { answered.add(key); details.acarreo = value }
      else { answered.delete(key); delete details.acarreo }
    }
    if (key === 'embalaje') {
      // La lista de objetos es abierta. No depender de un vocabulario cerrado.
      // Se pide aclaración cuando solo hay un Sí, sin objetos identificados.
      const hasObjects = !isNo && !/^(s[ií]|si por favor|s[ií] necesito|quiero embalaje|embalaje s[ií])\s*[.!,;]*$/i.test(value)
        && /[\p{L}]{3,}/u.test(value)
        && !/^(ind[ií]ca|necesitas que|qu[eé] art[ií]culos)/i.test(value)
      if (isNo || hasObjects) {
        answered.add(key); details.embalaje = value
        next.additionalServices.packing = !isNo
        if (!next.intake!.serviceAnswers.includes('packing')) next.intake!.serviceAnswers.push('packing')
        if (!isNo) {
          const note = `EMBALAJE: ${value}`
          const observations = next.additionalServices.observations || ''
          if (!observations.includes(note)) {
            next.additionalServices.observations = [observations === '__pending__' ? '' : observations, note].filter(Boolean).join('\n')
          }
        }
      } else { answered.delete(key); delete details.embalaje }
    }
  }
  // Declaraciones naturales no copiadas. Una palabra del enunciado original
  // nunca puede activar esta heurística.
  if (!diff.copiedForm) {
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
    `Acceso (ascensor o escaleras): ${fields.escaleras || (state.origin.details.hasElevator === true && state.destination.details.hasElevator === true ? 'Ascensor en origen y destino' : 'No informado')}`, 
    `Distancia de carga: ${fields.acarreo || 'No informado'}`,
    `Embalaje: ${fields.embalaje || 'No informado'}`,
    `Precio automático preliminar: ${estimated === null ? 'No calculable automáticamente' : `$${estimated.toLocaleString('es-CL')}`}`,
    'PENDIENTE DE REVISIÓN HUMANA: verificar distancias, volumen, accesos y tarifas antes de enviar precio definitivo.',
  ].join('\n')
}

/** Las líneas numeradas de Tommy no son etiquetas antiguas de la ficha técnica. */
export function isTommyFormReply(text: string): boolean {
  return /^\s*(?:[-•]\s*)?(?:[1-6]\s*[).:-]\s*)?(?:direcciones? de origen y destino|lista de art[ií]culos|fecha del flete(?: o mudanza)?|acceso por ascensor o escalera|escaleras?|distancia de carga|acarreo|embalaje)\s*:/im.test(text)
}

/** También acepta el mensaje de pendientes que el usuario copió entero. */
export function isOnlyTommyServiceAnswers(text: string): boolean {
  const d = tommyDifferentialResult(text)
  return d.copiedForm && d.answers.length > 0 && !d.freeText &&
    d.answers.every(answer => ['escaleras', 'acarreo', 'embalaje'].includes(answer.field)) &&
    !d.answers.some(answer => answer.field === 'escaleras' && /ascensor/i.test(answer.value))
}
