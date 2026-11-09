/**
 * Contrato conversacional aprobado: cuatro etapas y ninguna derivación automática.
 * Estado persistido EXCLUSIVAMENTE en quote_sessions.state.intake (JSONB existente).
 */
import type { QuoteSessionState } from '@/lib/quoteSession'

export type QuoteFlowStep = 'questions' | 'photos' | 'inventory'

export const QUOTE_FIRST_MESSAGE = `¡Hola! 👋 Para cotizar tu flete o mudanza por favor responde:

1. Nombre, Email y Rut. Si eres empresa escribe boleta o factura y razón social. | Respuesta:

2. ¿De qué calle hasta qué calle es el traslado? Incluye número, comuna y región. | Respuesta:

3. Lista de artículos a trasladar. | Respuesta:

4. Fecha y hora del flete. Incluye un SI o NO si puedes cambiar la fecha. | Respuesta:

5. ¿Hay ascensor o escalera y en qué piso? Si es casa indícalo. | Respuesta:

6. ¿A qué distancia están las entradas del estacionamiento en el origen y destino respectivamente? | Respuesta:

7. ¿Necesitas que embalemos algo? Nombra qué artículos. | Respuesta:

8. ¿Necesitas que desarmemos y armemos muebles? Nómbralos. | Respuesta:

Puedes responder todo de 1 solo mensaje o puedes copiar este mensaje y responder después de cada pregunta en «Respuesta:».`

export const QUOTE_PHOTO_MESSAGE = `Envia fotos al analizador 📸

Envia fotos de tus articulos de traslado. Yo los reconocere y sumare al inventario. Escribe "NO" para omitir y avanzar`

export function inventoryMessage(list: string): string {
  return `Inventario 📦

${list || 'Todavía no hay artículos registrados.'}

Para modificar articulos de traslado.

Quitar: lista de articulos a eliminar

Agregar: lista de articulos a sumar

Para recibir tu cotizacion en PDF solo escribe confirmar`
}

export function quoteFlowStep(state: QuoteSessionState): QuoteFlowStep {
  return state.intake?.quoteFlowStep || 'questions'
}

export function withQuoteFlowStep(state: QuoteSessionState, step: QuoteFlowStep): QuoteSessionState {
  return { ...state, intake: { ...state.intake!, quoteFlowVersion: 2, quoteFlowStep: step }, confirmed: false }
}

/** Datos obligatorios para el precio o la emisión. Los opcionales del quoteStore
 * (paradas, prioridad, ayudantes extra, etc.) tienen sus valores por defecto del
 * cotizador web; si el cliente los menciona, el NLP los actualiza. */
export function missingQuoteQuestions(state: QuoteSessionState): string[] {
  const lines: string[] = []
  const add = (condition: boolean, question: string) => { if (condition) lines.push(question) }
  const p = state.personalInfo
  add(!p.name?.trim(), '¿Cuál es tu nombre?')
  add(!p.email?.trim(), '¿Cuál es tu correo electrónico?')
  add(!p.rut?.trim(), '¿Cuál es tu RUT?')
  add(!state.taxDocument, '¿Necesitas boleta o factura?')
  if (state.taxDocument === 'factura') {
    add(!p.companyName?.trim(), '¿Cuál es la razón social de la empresa?')
    add(!p.companyRut?.trim(), '¿Cuál es el RUT de la empresa?')
  }
  add(!state.schedule.date, '¿Qué fecha necesitas para el traslado?')
  add(!state.schedule.time, '¿A qué hora necesitas el traslado?')
  add(!(state.intake?.answeredQuoteFields || []).includes('isFlexible'), '¿Puedes cambiar la fecha? (Sí / No)')
  for (const [side, label] of [['origin', 'origen'], ['destination', 'destino']] as const) {
    const { address, details } = state[side]
    const fields = [
      !address.street?.trim() ? 'calle' : '',
      !address.number?.trim() ? 'número' : '',
      !address.commune?.trim() ? 'comuna' : '',
      !address.region?.trim() ? 'región' : '',
    ].filter(Boolean)
    add(fields.length > 0, `¿Cuál es ${fields.join(', ')} de ${label}?`)
    add(!details.propertyType, `¿El inmueble de ${label} es casa, departamento, oficina o bodega?`)
    add(details.floor === null || !Number.isInteger(details.floor) || details.floor < 0, `¿Qué piso corresponde al ${label}? (0 si es planta baja)`)
    add(details.hasElevator === null, `¿Hay ascensor en ${label}? (Sí / No)`)
    add(details.parkingDistance === null || !Number.isFinite(details.parkingDistance) || details.parkingDistance < 0,
      `¿Cuántos metros hay desde el estacionamiento hasta la entrada en ${label}? (0 si está junto a la entrada)`)
  }
  add(!state.items.length, '¿Qué artículos y cantidades necesitas trasladar?')
  for (const unresolved of state.pendingInventory) lines.push(`¿Qué tipo o tamaño es «${unresolved.sourceLabel}»?`)
  for (const photo of state.inventoryPhotos || []) {
    if (photo.status === 'needs_description') lines.push('¿Qué artículos aparecen en la foto pendiente de identificar?')
  }
  const answered = new Set(state.intake?.answeredQuoteFields || [])
  add(!answered.has('stops'), '¿Hay paradas intermedias para recoger o entregar artículos? (No, o Sí con dirección y qué se carga o descarga)')
  const extras = [
    ['unpacking', 'desembalaje'],
    ['extraHelpers', 'ayudantes adicionales (cantidad, 0 si ninguno)'],
    ['fridgeDisassembly', 'desarmado de refrigerador'],
    ['priority', 'servicio prioritario'],
    ['stairsCarry', 'muebles que deban ir por escalera incluso si hay ascensor'],
  ] as const
  const extrasPending = extras.filter(([key]) => !answered.has(key)).map(([, label]) => label)
  if (extrasPending.length) {
    lines.push(`¿Necesitas alguno de estos servicios: ${extrasPending.join('; ')}? Indica cuáles o responde NO si no necesitas ninguno.`)
  }
  for (const [key, label] of [
    ['packing', '¿Necesitas embalaje? Si es así, ¿para cuáles artículos?'],
    ['disassembly', '¿Necesitas desarmar algún mueble? Indica cuáles o responde No.'],
    ['assembly', '¿Necesitas armar algún mueble? Indica cuáles o responde No.'],
  ] as const) {
    add(!(state.intake?.answeredQuoteFields || []).includes(key), label)
  }
  return lines
}

export function missingQuoteMessage(state: QuoteSessionState): string | null {
  const pending = missingQuoteQuestions(state)
  if (!pending.length) return null
  return ['¡Gracias! 😊 Solo nos faltan estos datos:', '',
    ...pending.map((question, index) => `${index + 1}. ${question} | Respuesta:`), '',
    'Puedes responder todo en un solo mensaje o escribir después de cada «Respuesta:».',
  ].join('\n')
}

/** Al copiar el formulario, el modelo solo debe ver LAS RESPUESTAS y no tomar
 * las preguntas impresas como datos. Acepta respuestas de varias líneas. */
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
