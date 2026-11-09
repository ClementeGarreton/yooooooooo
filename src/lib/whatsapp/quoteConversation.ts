/**
 * Conversación breve de WhatsApp. El cliente habla libremente: el NLP extrae lo
 * explícito y lo implícito cuando el contexto lo permite. Jamás se inventa un
 * cargo o un dato físico para evitar repreguntar.
 * Persistencia: quote_sessions.state.intake (JSONB existente, sin migración).
 */
import type { QuoteSessionState } from '@/lib/quoteSession'

export type QuoteFlowStep = 'questions' | 'photos' | 'inventory' // 'photos' solo para sesiones anteriores

// La lista aprobada se divide EN DOS mensajes de WhatsApp. No se exige copiar
// un formulario ni se incluyen marcadores «Respuesta:».
export const QUOTE_INITIAL_QUESTIONS = [
  'Nombre, Email y Rut. Si eres empresa escribe boleta o factura y razón social.',
  '¿De qué calle hasta qué calle es el traslado? Incluye número, comuna y región.',
  'Lista de artículos a trasladar.',
  'Fecha y hora del flete. Incluye un SI o NO si puedes cambiar la fecha.',
  '¿Hay ascensor o escalera y en qué piso? Si es casa indícalo.',
  '¿A qué distancia están las entradas del estacionamiento en el origen y destino respectivamente?',
  '¿Necesitas que embalemos algo? Nombra qué artículos.',
  '¿Necesitas que desarmemos y armemos muebles? Nómbralos.',
]
export const QUOTE_FIRST_MESSAGE = `¡Hola! 👋 Para cotizar tu flete o mudanza, cuéntanos:

${QUOTE_INITIAL_QUESTIONS.slice(0, 4).map((q, i) => `${i + 1}. ${q}`).join('\n\n')}`
export const QUOTE_SECOND_MESSAGE = `${QUOTE_INITIAL_QUESTIONS.slice(4).map((q, i) => `${i + 5}. ${q}`).join('\n\n')}

Puedes responder todo junto, con tus propias palabras. 😊`

/** 0 = nuevo, 1 = preguntas 1–4 enviadas, 2 = preguntas 5–8
 * enviadas, 3 = ambas respuestas procesadas. Los estados antiguos, que
 * recibieron los dos mensajes juntos, se consideran completos (3).
 */
export function initialQuestionBatch(state: QuoteSessionState): 0 | 1 | 2 | 3 {
  return state.intake?.initialQuestionBatch ?? 3
}

/** Avanza únicamente tras procesar una respuesta del bloque activo. */
export function advanceInitialQuestionBatch(state: QuoteSessionState): QuoteSessionState {
  const batch = initialQuestionBatch(state)
  if (batch !== 1 && batch !== 2) return state
  return {
    ...state,
    intake: {
      ...state.intake!,
      initialQuestionBatch: batch === 1 ? 2 : 3,
      lastQuestionContext: batch === 1 ? QUOTE_INITIAL_QUESTIONS.slice(4) : state.intake?.lastQuestionContext,
    },
  }
}


export const QUOTE_PHOTO_MESSAGE = `Envía fotos al analizador 📸

Envía fotos de tus artículos de traslado. Yo los reconoceré y sumaré al inventario. Escribe «NO» para omitir y avanzar. Si envías fotos, escribe «LISTO» cuando termines.`

export const QUOTE_IDLE_MESSAGE = 'Han pasado 10 minutos desde tu última actividad. 😊 ¿Quieres *continuar* o *empezar de nuevo*?'

export function inventoryMessage(list: string): string {
  return `Inventario 📦

${list || 'Todavía no hay artículos registrados.'}

Para modificar artículos de traslado:

Quitar: lista de artículos a eliminar

Agregar: lista de artículos a sumar

Para recibir tu cotización en PDF solo escribe *confirmar*.`
}

export function quoteFlowStep(state: QuoteSessionState): QuoteFlowStep {
  // Compatibilidad: sesiones antiguas que esperaban «NO»/«LISTO» avanzan sin ese trámite.
  return state.intake?.quoteFlowStep === 'photos' ? 'inventory' : (state.intake?.quoteFlowStep || 'questions')
}

/** Sin preguntar por fotografías: el bot admite imágenes en cualquier etapa. */
export function nextAfterQuestions(state: QuoteSessionState): QuoteFlowStep {
  return missingQuoteQuestions(state).length ? 'questions' : 'inventory'
}

/** La confirmación del inventario no requiere un «LISTO» adicional por cada foto. */
export function readyToReviewInventory(state: QuoteSessionState): boolean {
  return state.items.length > 0 && state.pendingInventory.length === 0 &&
    !(state.inventoryPhotos || []).some(photo => photo.status !== 'done')
}

export function withQuoteFlowStep(state: QuoteSessionState, step: QuoteFlowStep): QuoteSessionState {
  return { ...state, intake: { ...state.intake!, quoteFlowVersion: 2, quoteFlowStep: step }, confirmed: false }
}

const blank = (value: string | null | undefined): boolean => !value?.trim()

/** Une datos en español sin exponer etiquetas internas del quoteStore. */
function joinSpanish(parts: string[]): string {
  if (parts.length < 2) return parts[0] || ''
  return `${parts.slice(0, -1).join(', ')} y ${parts[parts.length - 1]}`
}

function addressMissing(state: QuoteSessionState, side: 'origin' | 'destination'): string[] {
  const address = state[side].address
  return ([['street', 'la calle'], ['number', 'el número'], ['commune', 'la comuna'], ['region', 'la región']] as const)
    .filter(([key]) => blank(address[key])).map(([, label]) => label)
}

function missingAccess(state: QuoteSessionState, side: 'origin' | 'destination') {
  const details = state[side].details
  return {
    property: !details.propertyType,
    floor: details.floor === null || !Number.isInteger(details.floor) || details.floor < 0,
    elevator: details.hasElevator === null && !(details.propertyType === 'casa' && details.floor === 0),
  }
}

/** Pregunta con frases completas. Nunca interpola «salida: piso, ascensor». */
function accessQuestion(state: QuoteSessionState): string | null {
  const parts: string[] = []
  for (const side of ['origin', 'destination'] as const) {
    const need = missingAccess(state, side)
    if (!need.property && !need.floor && !need.elevator) continue
    const location = side === 'origin' ? 'origen' : 'destino'
    const action = side === 'origin' ? 'retiraremos' : 'dejaremos'
    if (need.property) {
      parts.push(`¿El lugar de ${location} es una casa, un departamento, una oficina o una bodega?`)
    }
    if (need.floor && need.elevator) {
      parts.push(`En el ${location}, ¿en qué piso ${action} los muebles? ¿Hay ascensor allí?`)
    } else if (need.floor) {
      parts.push(`En el ${location}, ¿en qué piso ${action} los muebles?`)
    } else if (need.elevator) {
      parts.push(`¿Hay ascensor en el ${location}?`)
    }
  }
  return parts.length ? parts.join(' ') : null
}

/** Una pregunta por TEMA, en español natural y sin exponer claves internas.
 * Los servicios opcionales no se transforman en nuevas obligaciones.
 */
export function missingQuoteQuestions(state: QuoteSessionState): string[] {
  const questions: string[] = []
  const p = state.personalInfo
  const contact = [blank(p.name) ? 'tu nombre' : '', blank(p.email) ? 'tu correo' : '', blank(p.rut) ? 'tu RUT' : ''].filter(Boolean)
  const billing = !state.taxDocument ? '¿Necesitas boleta o factura?' : state.taxDocument === 'factura'
    ? (blank(p.companyName) || blank(p.companyRut))
      ? `¿Me compartes ${joinSpanish([blank(p.companyName) ? 'la razón social' : '', blank(p.companyRut) ? 'el RUT de la empresa' : ''].filter(Boolean))}?`
      : '' : ''
  if (contact.length) questions.push(`¿Me compartes ${joinSpanish(contact)}?${billing ? ` ${billing}` : ''}`)
  else if (billing) questions.push(billing)

  const needDate = !state.schedule.date
  const needTime = !state.schedule.time
  const needFlexibility = !state.intake?.answeredQuoteFields?.includes('isFlexible')
  if (needDate || needTime || needFlexibility) {
    const when = needDate && needTime ? '¿Qué día y a qué hora necesitas el traslado?'
      : needDate ? '¿Qué día necesitas el traslado?'
      : needTime ? '¿A qué hora necesitas el traslado?' : ''
    const flexibility = needFlexibility ? '¿Podrías cambiar la fecha si fuera necesario?' : ''
    questions.push([when, flexibility].filter(Boolean).join(' '))
  }

  const addressQuestions: string[] = []
  for (const side of ['origin', 'destination'] as const) {
    const missing = addressMissing(state, side)
    if (missing.length) {
      addressQuestions.push(`De la dirección de ${side === 'origin' ? 'origen' : 'destino'}, ¿me confirmas ${joinSpanish(missing)}?`)
    }
  }
  if (addressQuestions.length) questions.push(addressQuestions.join(' '))

  const access = accessQuestion(state)
  if (access) questions.push(access)

  const originDistance = state.origin.details.parkingDistance
  const destinationDistance = state.destination.details.parkingDistance
  const originMissing = originDistance === null || !Number.isFinite(originDistance)
  const destMissing = destinationDistance === null || !Number.isFinite(destinationDistance)
  if (originMissing || destMissing) {
    const location = originMissing && destMissing ? 'en el origen y en el destino'
      : originMissing ? 'en el origen' : 'en el destino'
    questions.push(`¿Cuántos metros hay que caminar con los muebles desde el camión hasta la entrada ${location}? Si se estaciona junto a la puerta, responde 0 metros.`)
  }

  if (!state.items.length) questions.push('¿Qué muebles o artículos trasladamos y cuántos de cada uno? Puedes describirlos o enviar una foto.')
  const pendingItems = state.pendingInventory.filter(p => !/\b(?:ascensor|piso|estacionamiento|pregunta|respuesta)\b/i.test(p.sourceLabel))
  if (pendingItems.length) questions.push(`¿Me aclaras qué artículos son ${pendingItems.map(p => `«${p.sourceLabel}»`).join(', ')}?`)

  const answered = new Set(state.intake?.answeredQuoteFields || [])
  const services = [!answered.has('packing') ? 'embalaje' : '',
    !answered.has('disassembly') ? 'desarmado de muebles' : '',
    !answered.has('assembly') ? 'armado de muebles' : ''].filter(Boolean)
  if (services.length) questions.push(`¿Necesitas alguno de estos servicios: ${joinSpanish(services)}? Si no, responde «no».`)
  return questions
}

export function pendingWithoutInventory(state: QuoteSessionState): string[] {
  return missingQuoteQuestions(state).filter(q => !q.startsWith('¿Qué muebles o artículos'))
}

export function missingQuoteMessage(state: QuoteSessionState): string | null {
  const pending = missingQuoteQuestions(state)
  if (!pending.length) return null
  return ['¡Gracias! 😊 Solo me falta aclarar esto:', ...pending.map((question, index) => `${index + 1}. ${question}`),
    'Puedes responder todo junto, con tus propias palabras.'].join('\n')
}

/** Reformula según lo que realmente falta, no según etiquetas técnicas. */
export function paraphraseQuoteQuestion(question: string, state?: QuoteSessionState): string {
  if (/ascensor|piso|accesos|inmueble|casa|departamento|bodega/i.test(question)) {
    if (state) {
      const pending = accessQuestion(state)
      if (pending) return `Me refiero a los lugares donde recogeremos y entregaremos tus cosas. ${pending}`
      return 'Perfecto, con eso ya están claros los accesos.'
    }
    return 'Me refiero a ambos lugares: ¿son casas o departamentos? Si alguno es departamento, dime en qué piso está y si tiene ascensor.'
  }
  if (/metro|caminar|estaciona/i.test(question)) return 'Me refiero a la distancia que tendremos que caminar con tus cosas entre el camión y la entrada. ¿Cuántos metros son aproximadamente? Si estacionamos justo al lado, son 0 metros.'
  if (/embal|desarm|armar/i.test(question)) return '¿Quieres que protejamos tus cosas con embalaje o que desmontemos y volvamos a montar algún mueble? Si no necesitas estos servicios, basta con decir «no».'
  if (/artículo|mueble/i.test(question)) return '¿Qué cosas debemos trasladar y cuántas de cada una? Por ejemplo: una cama y dos refrigeradores.'
  if (/boleta|factura|razón social|RUT/i.test(question)) return '¿Necesitas boleta o factura? Si es factura, indícame la razón social y el RUT de la empresa.'
  if (/fecha|hora/i.test(question)) return '¿Qué día y a qué hora te gustaría hacer la mudanza? Dime también si tienes flexibilidad para cambiar la fecha.'
  if (/dirección|calle|comuna|región/i.test(question)) return '¿Me indicas la dirección donde recogeremos tus cosas y la dirección donde las entregaremos, con calle, número, comuna y región?'
  if (/nombre|correo/i.test(question)) return 'Para preparar la cotización, ¿me dices tu nombre, correo electrónico y RUT?'
  return 'Disculpa, no me expliqué bien. ¿Puedes contarme qué parte de la pregunta te resulta confusa?'
}

export function isQuoteConfusion(text: string): boolean {
  return /(?:no\s+(?:lo\s+)?(?:entend[ií]|entiendo|comprend[ií]|comprendo|cach[eé])|no\s+se\s+entiende|qu[eé]\s+(?:quieres\s+decir|significa)|expl[ií]ca(?:me)?|a\s+qu[eé]\s+te\s+refieres|no\s+me\s+queda\s+claro)/i.test(text)
}

/**
 * Resuelve «no a la primera» y «sí a la segunda» contra las preguntas REALES
 * enviadas. Esto evita que una respuesta breve se pierda si el NLP falla al
 * alinear el referente. Solo toca booleanos inequívocos, nunca direcciones ni
 * muebles.
 */
export function applyContextualYesNo(
  state: QuoteSessionState, raw: string, questions: string[],
): QuoteSessionState {
  const next = structuredClone(state)
  const wordNumbers: Record<string, number> = {primera:0,segunda:1,tercera:2,cuarta:3,quinta:4,sexta:5}
  const answered = new Set(next.intake?.answeredQuoteFields || [])
  const matches = [...raw.matchAll(/\b(no|s[ií])\s+a\s+la\s+(primera|segunda|tercera|cuarta|quinta|sexta)\b/gi)]
  for (const match of matches) {
    const answer = match[1].toLowerCase() !== 'no'
    const q = questions[wordNumbers[match[2].toLowerCase()]] || ''
    if (!q) continue
    const mentionsOrigin = /(?:origen|salida)/i.test(q)
    const mentionsDestination = /(?:destino|llegada)/i.test(q)
    if (/ascensor/i.test(q) && mentionsOrigin !== mentionsDestination) {
      next[mentionsOrigin ? 'origin' : 'destination'].details.hasElevator = answer
    } else if (/flexibilidad|cambiar la fecha/i.test(q)) {
      next.schedule.isFlexible = answer; answered.add('isFlexible')
    } else if (/embalaje|embalar|desarmado|armado/i.test(q) && !answer) {
      if (/embalaje|embalar/i.test(q)) {next.additionalServices.packing=false;answered.add('packing')}
      if (/desarmado|desarmar/i.test(q)) {next.additionalServices.disassembly=false;answered.add('disassembly')}
      if (/armado|armar/i.test(q)) {next.additionalServices.assembly=false;answered.add('assembly')}
    }
  }
  if (next.intake) next.intake.answeredQuoteFields = [...answered]
  return next
}

/** Compatible con respuestas de formularios anteriores, sin pedir que se copien. */
export function normalizeQuoteCustomerReply(raw: string): string {
  const headings = [...raw.matchAll(/^\s*(\d{1,2})[.)]\s+[^\n]*?\brespuesta\s*:/gim)]
  if (!headings.length) return raw.trim()
  const answers: string[] = []
  for (let i = 0; i < headings.length; i += 1) {
    const here = headings[i]
    const next = headings[i + 1]
    const answer = raw.slice((here.index || 0) + here[0].length, next?.index ?? raw.length)
      .split(/\n\s*Puedes responder todo de 1 solo mensaje/i)[0]
      .replace(/^\s*<\s*|\s*>\s*$/g, '').trim()
    if (answer) answers.push(`Pregunta ${here[1]}: ${answer}`)
  }
  return answers.join('\n')
}

export function isPhotoFinish(text: string) {
  return /^(no|listo|termin[eé]|termine|eso es todo)[.!\s]*$/i.test(text.trim())
}

export function isInventoryConfirm(text: string) {
  return /^confirmar[.!\s]*$/i.test(text.trim())
}
