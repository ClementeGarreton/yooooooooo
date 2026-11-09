/**
 * Conversación breve de WhatsApp. El cliente habla libremente: el NLP extrae lo
 * explícito y lo implícito cuando el contexto lo permite. Jamás se inventa un
 * cargo o un dato físico para evitar repreguntar.
 * Persistencia: quote_sessions.state.intake (JSONB existente, sin migración).
 */
import type { QuoteSessionState } from '@/lib/quoteSession'

export type QuoteFlowStep = 'questions' | 'photos' | 'inventory'

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
  return state.intake?.quoteFlowStep || 'questions'
}

export function withQuoteFlowStep(state: QuoteSessionState, step: QuoteFlowStep): QuoteSessionState {
  return { ...state, intake: { ...state.intake!, quoteFlowVersion: 2, quoteFlowStep: step }, confirmed: false }
}

const blank = (value: string | null | undefined): boolean => !value?.trim()
function addressMissing(state: QuoteSessionState, side: 'origin' | 'destination'): string[] {
  const a = state[side].address
  return ([['street', 'calle'], ['number', 'número'], ['commune', 'comuna'], ['region', 'región']] as const)
    .filter(([key]) => blank(a[key])).map(([, title]) => title)
}

/** Una pregunta por TEMA, no una pregunta por cada propiedad del quoteStore.
 * Extras optativos (paradas, prioridad, ayudantes, desembalaje, etc.) NO son
 * confirmaciones obligatorias. Se respetan cuando el cliente los menciona.
 */
export function missingQuoteQuestions(state: QuoteSessionState): string[] {
  const questions: string[] = []
  const p = state.personalInfo
  const contact = [blank(p.name) ? 'nombre' : '', blank(p.email) ? 'correo' : '', blank(p.rut) ? 'RUT' : ''].filter(Boolean)
  const billing = !state.taxDocument ? 'si necesitas boleta o factura' : state.taxDocument === 'factura'
    ? [blank(p.companyName) ? 'razón social' : '', blank(p.companyRut) ? 'RUT de la empresa' : ''].filter(Boolean).join(' y ') : ''
  const client = [...contact, billing].filter(Boolean)
  if (client.length) questions.push(`Para tus datos, ¿me confirmas ${client.join(', ')}?`)

  const schedule = [!state.schedule.date ? 'fecha' : '', !state.schedule.time ? 'hora' : '',
    !state.intake?.answeredQuoteFields?.includes('isFlexible') ? 'si puedes cambiar la fecha (sí o no)' : ''].filter(Boolean)
  if (schedule.length) questions.push(`Del traslado, ¿me indicas ${schedule.join(', ')}?`)

  const addresses = ([['origin','salida'],['destination','llegada']] as const)
    .map(([side, label]) => ({ label, missing: addressMissing(state, side) }))
    .filter(x => x.missing.length)
  if (addresses.length) questions.push(`De las direcciones, falta ${addresses.map(x=>`${x.label}: ${x.missing.join(', ')}`).join('; ')}. ¿Me lo indicas?`)

  const access = ([['origin','salida'],['destination','llegada']] as const).map(([side,label]) => {
    const d = state[side].details
    const needed = [!d.propertyType ? 'casa o departamento' : '',
      d.floor === null || !Number.isInteger(d.floor) || d.floor < 0 ? 'piso de los muebles' : '',
      d.hasElevator === null && !(d.propertyType === 'casa' && d.floor === 0) ? 'si se usa ascensor' : '',
    ].filter(Boolean)
    return {label,needed}
  }).filter(x=>x.needed.length)
  if (access.length) questions.push(`De los accesos, ¿me aclaras ${access.map(x=>`${x.label}: ${x.needed.join(', ')}`).join('; ')}?`)

  const originDistance = state.origin.details.parkingDistance
  const destinationDistance = state.destination.details.parkingDistance
  const parkingSides = [originDistance === null || !Number.isFinite(originDistance) ? 'salida' : '',
    destinationDistance === null || !Number.isFinite(destinationDistance) ? 'llegada' : ''].filter(Boolean)
  if (parkingSides.length) questions.push(`¿Cuántos metros hay que caminar cargando desde el camión hasta la puerta en ${parkingSides.join(' y ')}? (0 si estaciona en la entrada)`)

  if (!state.items.length) questions.push('¿Qué muebles o artículos trasladamos y cuántos de cada uno? También puedes enviarlos en fotos después.')
  const pendingItems = state.pendingInventory.filter(p => !/\b(?:ascensor|piso|estacionamiento|pregunta|respuesta)\b/i.test(p.sourceLabel))
  if (pendingItems.length) questions.push(`¿Qué artículos son «${pendingItems.map(p => p.sourceLabel).join('», «')}»?`)

  const answered = new Set(state.intake?.answeredQuoteFields || [])
  const services = [!answered.has('packing') ? 'embalaje' : '',
    !answered.has('disassembly') ? 'desarmado' : '', !answered.has('assembly') ? 'armado' : ''].filter(Boolean)
  if (services.length) questions.push(`¿Necesitas ${services.join(', ')} de muebles? Indica cuáles o simplemente «no».`)
  return questions
}

export function pendingWithoutInventory(state: QuoteSessionState): string[] {
  return missingQuoteQuestions(state).filter(q => !q.startsWith('¿Qué muebles o artículos'))
}

export function missingQuoteMessage(state: QuoteSessionState): string | null {
  const pending = missingQuoteQuestions(state)
  if (!pending.length) return null
  return ['¡Gracias! 😊 Solo necesito aclarar esto:', ...pending.map((question, index) => `${index + 1}. ${question}`),
    'Respóndeme como quieras, todo junto.'].join('\n')
}

/** Reformulación humana, no repetir literalmente la pregunta incomprendida.
 * Puede usarse cuando el cliente dice «no entendí», incluso si ya contestó
 * otros puntos en el mismo mensaje.
 */
export function paraphraseQuoteQuestion(question: string): string {
  if (/ascensor|piso/i.test(question)) return 'Por ejemplo, en la salida: «departamento, piso 5, con ascensor». En la llegada: «casa, planta baja». ¿Cómo es en tu caso?'
  if (/metro|caminar|estaciona/i.test(question)) return 'Me refiero al trayecto desde donde queda estacionado el camión hasta la puerta. ¿Es justo al lado (0 m), a unos 10 m, 20 m o más?'
  if (/embalar|desarmar|armar/i.test(question)) return '¿Quieres que nosotros envolvamos cosas para protegerlas o que desmontemos y volvamos a montar algún mueble? Si no, basta con decir «no». '
  if (/artículo|mueble/i.test(question)) return 'Para calcular cuánto ocupa la mudanza, dime qué cosas llevas y cuántas; por ejemplo «una cama y dos refrigeradores». '
  if (/boleta|factura/i.test(question)) return '¿El comprobante lo necesitas a tu nombre (boleta) o a nombre de una empresa (factura)?'
  if (/fecha/i.test(question)) return '¿Ya tienes un día para la mudanza o podríamos coordinar otro?'
  if (/dirección|calle|comuna/i.test(question)) return 'Necesito la dirección para retirar tus cosas y la dirección donde las dejaremos: calle, número y comuna de cada lugar.'
  return `Te lo pregunto de otra forma: ${question.replace(/^¿/, '').replace(/\?$/, '').replace(/me indicas|me confirmas|me aclaras/i, 'puedes decirme')}?`
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
