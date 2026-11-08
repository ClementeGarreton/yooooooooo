/** Contrato de atención aprobado por Tommy (2026-11-07).
 * Los seis grupos se presentan al cliente; los demás campos internos no se le exigen.
 * Este módulo es deliberadamente puro para que sus reglas puedan probarse sin DB ni IA.
 */
import type { QuoteSessionState } from '../quoteSession'
import { extractTommyDifferential, type DiffField } from './tommyDifferential.ts'
import { accessPendingLines } from './tommyAccess.ts'

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
  '4) Escaleras: indícanos qué artículos hay que subir o bajar por escalera, cuántos pisos y si es en el origen, el destino o ambos. Si no hay, responde No. | Respuesta:',
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
  const lines: string[] = []
  for (const name of missing) {
    if (name === 'escaleras') {
      lines.push('- Acceso por ascensor o escalera:')
      lines.push(...accessPendingLines(state.intake?.tommyAccess))
    } else {
      lines.push(`- ${labels[name]} | Respuesta:`)
    }
  }
  return [
    '¡Gracias por la información! 🙌 Para enviarte el presupuesto solo nos falta:',
    '', ...lines, '',
    'Copia este mensaje y completa cada «Respuesta:» por separado.',
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
export const TOMMY_PENDING_REFERENCE = [
  '- ' + labels.direcciones,
  '- ' + labels.articulos,
  '- ' + labels.fecha,
  '- ' + labels.escaleras,
  '- ' + labels.acarreo,
  '- ' + labels.embalaje,
].join('\n')

function references(state?: QuoteSessionState): string[] {
  return [TOMMY_QUOTE_START, TOMMY_PENDING_REFERENCE, ...(state ? [tommyPendingMessage(state) || ''] : [])]
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
      // Sí necesita también ubicación, pisos y artículos; No se resuelve solo.
      const informative = /\b(origen|destino|ambos)\b/i.test(value) &&
        /\b(?:\d+(?:er|ro|do|°|º)?|uno|dos|tres|cuatro|cinco|primer|segundo|tercer)\s*(?:pisos?|plantas?)\b/i.test(value) &&
        /\b(camas?|cajas?|sof[aá]s?|sill[oó]nes?|mesas?|escritorios?|muebles?|televisores?|lavadoras?|refrigeradores?|art[ií]culos?|todos?)\b/i.test(value)
      if (isNo || informative) { answered.add(key); details.escaleras = value }
      else { answered.delete(key); delete details.escaleras }
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
    `Escaleras: ${fields.escaleras || 'No informado'}`,
    `Distancia de carga: ${fields.acarreo || 'No informado'}`,
    `Embalaje: ${fields.embalaje || 'No informado'}`,
    `Precio automático preliminar: ${estimated === null ? 'No calculable automáticamente' : `$${estimated.toLocaleString('es-CL')}`}`,
    'PENDIENTE DE REVISIÓN HUMANA: verificar distancias, volumen, accesos y tarifas antes de enviar precio definitivo.',
  ].join('\n')
}

/** Las líneas numeradas de Tommy no son etiquetas antiguas de la ficha técnica. */
export function isTommyFormReply(text: string): boolean {
  return /^\s*(?:[-•]\s*)?(?:[1-6]\s*[).:-]\s*)?(?:direcciones? de origen y destino|lista de art[ií]culos|fecha del flete(?: o mudanza)?|escaleras?|distancia de carga|acarreo|embalaje)\s*:/im.test(text)
}

/** También acepta el mensaje de pendientes que el usuario copió entero. */
export function isOnlyTommyServiceAnswers(text: string): boolean {
  const d = tommyDifferentialResult(text)
  return d.copiedForm && d.answers.length > 0 && !d.freeText &&
    d.answers.every(answer => ['escaleras', 'acarreo', 'embalaje'].includes(answer.field))
}
