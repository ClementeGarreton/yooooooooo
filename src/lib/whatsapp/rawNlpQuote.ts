/** Cotizador WhatsApp: un único parser OpenAI por mensaje natural.
 * Sin diff, regex interpretativas, reglas de preguntas encadenadas ni segundo parser.
 * Las únicas comprobaciones locales son tipos, IDs del catálogo y datos mínimos para precio/PDF.
 */
import type { QuoteSessionState } from '@/lib/quoteSession'
import { createStructuredResponseWithUsage } from '@/lib/ai/openai'
import { supabaseAdmin } from '@/lib/supabase'

const fields = [
  'originStreet','originNumber','originCommune','originRegion','destinationStreet','destinationNumber','destinationCommune','destinationRegion',
  'date','time','originFloor','destinationFloor','originElevator','destinationElevator','originParkingMeters','destinationParkingMeters',
  'stairsAnswer','stairsDetail','originStairs','destinationStairs','stairsItemsMode','stairsItemsDetail','carryAnswer','carryDetail','packingAnswer','packingDetail',
  'inventoryAction',
] as const

type Field = typeof fields[number]
type Data = {
  originStreet: string | null; originNumber: string | null; originCommune: string | null; originRegion: string | null
  destinationStreet: string | null; destinationNumber: string | null; destinationCommune: string | null; destinationRegion: string | null
  date: string | null; time: string | null
  originFloor: number | null; destinationFloor: number | null; originElevator: boolean | null; destinationElevator: boolean | null
  originParkingMeters: number | null; destinationParkingMeters: number | null
  stairsAnswer: boolean | null; stairsDetail: string | null
  originStairs: boolean | null; destinationStairs: boolean | null
  stairsItemsMode: 'none' | 'all' | 'list'; stairsItemsDetail: string | null
  stairsInventory: Array<{ catalogItemId: string; quantity: number }>
  carryAnswer: boolean | null; carryDetail: string | null
  packingAnswer: boolean | null; packingDetail: string | null
  inventoryAction: 'none' | 'replace' | 'add'
  inventory: Array<{ catalogItemId: string; quantity: number; source: string }>
  unresolved: string[]
}
const strings = ['originStreet','originNumber','originCommune','originRegion','destinationStreet','destinationNumber','destinationCommune','destinationRegion','date','time','stairsDetail','stairsItemsDetail','carryDetail','packingDetail']
const numbers = ['originFloor','destinationFloor','originParkingMeters','destinationParkingMeters']
const bools = ['originElevator','destinationElevator','originStairs','destinationStairs','stairsAnswer','carryAnswer','packingAnswer']
const props: Record<string, unknown> = {}
for (const k of strings) props[k] = { type: ['string','null'] }
for (const k of numbers) props[k] = { type: ['number','null'] }
for (const k of bools) props[k] = { type: ['boolean','null'] }
props.stairsItemsMode = { type:'string', enum:['none','all','list'] }
props.stairsInventory = {type:'array', items: {type:'object', additionalProperties:false,
  properties: {catalogItemId:{type:'string'},quantity:{type:'integer'}}, required:['catalogItemId','quantity'] }}
props.inventoryAction = { type: 'string', enum: ['none','replace','add'] }
props.inventory = { type: 'array', items: { type: 'object', additionalProperties: false,
  properties: { catalogItemId: {type:'string'}, quantity:{type:'integer'}, source:{type:'string'} },
  required: ['catalogItemId','quantity','source'] } }
props.unresolved = { type:'array', items: { type:'string' } }
const schema = { type: 'object', additionalProperties: false, properties: props,
  required: [...fields, 'inventory', 'stairsInventory', 'unresolved'] }

function compact(state: QuoteSessionState) {
  return {
    origin: state.origin, destination: state.destination, schedule: state.schedule,
    items: state.items, serviceAnswers: state.intake?.tommyAnswers || [],
    serviceDetails: state.intake?.tommyDetails || {}, access: state.intake?.tommyAccess || {}, packing: state.additionalServices.packing,
    pendingQuestions: rawQuoteGaps(state).length ? nextShortQuestion(state) : null,
  }
}

export async function parseRawCustomerQuote(state: QuoteSessionState, rawMessage: string) {
  const { data: catalog, error } = await supabaseAdmin.from('catalog_items')
    .select('id,name,category').eq('is_active',true).order('name')
  if (error) throw new Error(`Catálogo no disponible: ${error.message}`)
  const rows = (catalog || []).map((r: any) => ({ id: String(r.id), name: String(r.name), category: String(r.category || '') }))
  const ids = new Set(rows.map(r => r.id))
  const { data, usage } = await createStructuredResponseWithUsage<Data>({
    // Sol prioriza capacidad semántica sin pagar el coste de reasoning alto en cada mensaje.
    model: process.env.OPENAI_NLP_MODEL || 'gpt-6.1-sol', reasoningEffort: 'low', ignoreGlobalReasoningEffort: true,
    schemaName: 'whatsapp_raw_quote_nlp', schema, maxOutputTokens: 3800,
    instructions: `Eres el ÚNICO intérprete semántico de una cotización de mudanzas en Chile.
Recibes el mensaje del cliente sin modificar, posiblemente con un formulario copiado y editado.
Extrae TODA la información nueva en un JSON, sin restringir dialectos, faltas ortográficas ni estilo.
Si copia preguntas, diferencia la pregunta de la respuesta añadida; no leas palabras de la pregunta como respuesta.
Interpreta frases naturales y respuestas numeradas SEGÚN pendingQuestions en el estado; los números son índices de esas preguntas, no campos absolutos. Si escribe "50mts", es una distancia de carga de 50 metros.
Si dice "no hay escaleras", stairsAnswer=false. Si dice "5 pisos en origen" originFloor=5.
"Ascensor" y "escaleras" son cosas diferentes. No inventes ascensores a partir del piso.
Si se usarán escaleras en origen o destino, marca originStairs/destinationStairs. «5 pisos por escaleras en origen» => originStairs=true y originFloor=5; el destino sigue null salvo respuesta explícita.
«No usaremos escaleras en ninguna parte» => originStairs=false y destinationStairs=false. Si se usan escaleras en un lugar, NO deduzcas que el otro es false sin confirmación.
Si el cliente dice qué muebles irán por escalera, stairsItemsMode='all' si TODOS (todo el inventario), o 'list' si da algunos concretos: rellena stairsInventory con IDs y cantidades válidas del inventario actual. stairsItemsDetail describe exactamente los muebles. Si no lo dice, stairsItemsMode='none' y stairsInventory=[]; no supongas TODOS.
No confundas muebles de embalaje con muebles que irán por escalera.
Si ya se sabe «50mts» pero faltaba a qué extremo corresponde, y ahora indica «en origen», «en destino» o «ambos», aplica esos 50 metros al extremo indicado sin preguntarlos otra vez.
Respeta las palabras "origen", "destino", "ambos" y los nombres de comunas; solo llena lados indicados inequívocamente.
Conserva lo conocido: en la salida, los campos NO mencionados en este turno deben ser null.
Una negación explícita para un servicio es false, ausencia de respuesta es null.
Para escaleras/acarreo/embalaje, devuelve respuesta y detalle; registra metros SOLO en los extremos mencionados, sin convertir un lado no informado a 0. Para acarreo negado expresamente devuelve carryAnswer=false.
Los muebles SOLO se asignan a IDs del catálogo dado. Incluye cantidades. Si el mensaje repite un inventario completo, inventoryAction=replace; si solo agrega muebles, add; si no contiene inventario, none.
No cambies la cantidad de un ítem ya registrado si solo lo menciona como contexto de embalaje/escaleras. Si escribe los ítems listados de nuevo con cantidades iguales en un formulario copiado, usa replace, nunca los sumes.
Si un objeto a trasladar no coincide con catálogo, no inventes ID: regístralo en unresolved para solicitar aclaración solo si realmente es indispensable.
Si una comuna identifica inequívocamente la región (ej. Las Condes = Metropolitana), puedes normalizar la región.
La fecha actual en Chile es ${new Date().toLocaleDateString('en-CA',{timeZone:'America/Santiago'})}. Devuelve fecha YYYY-MM-DD y hora HH:mm si la dijo.
El sistema hará máximo tres tandas de recopilación. Tu tarea es SOLO extraer los campos del texto. No redactes preguntas.
NO estimes ni inventes precios; el servidor calcula con las tarifas oficiales.
Catálogo válido: ${JSON.stringify(rows)}
Estado previamente confirmado (contexto, NO lo copies en el resultado): ${JSON.stringify(compact(state))}`,
    input: [{ role:'user', content: rawMessage }],
  })
  // Nunca aceptar IDs arbitrarios producidos por un LLM.
  data.inventory = data.inventory.filter(i => ids.has(i.catalogItemId) && Number.isInteger(i.quantity) && i.quantity > 0 && i.quantity <= 100)
  data.stairsInventory = data.stairsInventory.filter(i => ids.has(i.catalogItemId) && Number.isInteger(i.quantity) && i.quantity > 0 && i.quantity <= 100)
  return { data, usage }
}

function assign<T extends object, K extends keyof T>(obj: T, key: K, value: T[K] | null) {
  if (value !== null && value !== undefined && (typeof value !== 'string' || value.trim())) obj[key] = value
}

export function mergeRawQuote(state: QuoteSessionState, d: Data): QuoteSessionState {
  const next: QuoteSessionState = structuredClone(state)
  assign(next.origin.address,'street',d.originStreet); assign(next.origin.address,'number',d.originNumber)
  assign(next.origin.address,'commune',d.originCommune); assign(next.origin.address,'region',d.originRegion)
  assign(next.destination.address,'street',d.destinationStreet); assign(next.destination.address,'number',d.destinationNumber)
  assign(next.destination.address,'commune',d.destinationCommune); assign(next.destination.address,'region',d.destinationRegion)
  assign(next.schedule,'date',d.date); assign(next.schedule,'time',d.time)
  assign(next.origin.details,'floor',d.originFloor); assign(next.destination.details,'floor',d.destinationFloor)
  assign(next.origin.details,'hasElevator',d.originElevator); assign(next.destination.details,'hasElevator',d.destinationElevator)
  // Una corrección posterior puede invalidar un «NO» anterior, que había guardado 0 m.
  if (d.carryAnswer === true && state.intake?.tommyDetails?.acarreo === 'No') {
    next.origin.details.parkingDistance = null
    next.destination.details.parkingDistance = null
  }
  assign(next.origin.details,'parkingDistance',d.originParkingMeters)
  assign(next.destination.details,'parkingDistance',d.destinationParkingMeters)
  if (d.carryAnswer === false) {
    next.origin.details.parkingDistance = 0
    next.destination.details.parkingDistance = 0
  }
  if (d.packingAnswer !== null) next.additionalServices.packing = d.packingAnswer
  next.intake ||= { stage:'describe', serviceAnswers: [], tommyVersion: 1, tommyAnswers:[], tommyDetails:{} }
  const access = { ...(next.intake.tommyAccess || {}) }
  if (d.stairsAnswer === false) {
    access.originStairs = false
    access.destinationStairs = false
  }
  if (d.originStairs !== null) access.originStairs = d.originStairs
  if (d.destinationStairs !== null) access.destinationStairs = d.destinationStairs
  if (d.originFloor !== null && (d.stairsAnswer === true || d.originStairs === true)) access.originStairs = true
  if (d.destinationFloor !== null && (d.stairsAnswer === true || d.destinationStairs === true)) access.destinationStairs = true
  if (d.originElevator !== null) access.originElevator = d.originElevator
  if (d.destinationElevator !== null) access.destinationElevator = d.destinationElevator
  if (d.originFloor !== null && access.originStairs === true) access.originFloors = d.originFloor
  if (d.destinationFloor !== null && access.destinationStairs === true) access.destinationFloors = d.destinationFloor
  next.intake.tommyAccess = access
  const marked = new Set(next.intake.tommyAnswers || [])
  const details = {...next.intake.tommyDetails}
  if (d.stairsAnswer !== null || d.stairsDetail || d.originStairs !== null || d.destinationStairs !== null) {
    marked.add('escaleras')
    details.escaleras = (access.originStairs === false && access.destinationStairs === false)
      ? 'No' : (d.stairsDetail || details.escaleras || 'Sí')
  }
  if (d.carryAnswer !== null || d.carryDetail || d.originParkingMeters !== null || d.destinationParkingMeters !== null) {
    marked.add('acarreo')
    const meters = [d.originParkingMeters !== null ? `origen ${d.originParkingMeters} m` : '',
      d.destinationParkingMeters !== null ? `destino ${d.destinationParkingMeters} m` : ''].filter(Boolean).join('; ')
    details.acarreo = d.carryAnswer === false ? 'No' : (d.carryDetail || meters || 'Sí')
  }
  if (d.packingAnswer !== null || d.packingDetail) {
    marked.add('embalaje'); details.embalaje = d.packingDetail || (d.packingAnswer ? 'Sí' : 'No')
    if (d.packingDetail) next.additionalServices.observations = [next.additionalServices.observations === '__pending__' ? '' : next.additionalServices.observations,d.packingDetail].filter(Boolean).join('; ')
  }
  next.intake.tommyDetails = details
  next.intake.tommyAnswers = [...marked]
  if (d.inventoryAction !== 'none' && d.inventory.length) {
    const replacement = new Map<string,number>()
    if (d.inventoryAction === 'add') for (const item of next.items) replacement.set(item.catalogItemId,item.quantity)
    for (const item of d.inventory) replacement.set(item.catalogItemId,item.quantity)
    next.items = [...replacement.entries()].map(([catalogItemId,quantity])=>({catalogItemId,quantity}))
    next.pendingInventory = []
    next.inventoryCollectionDone = true
  }
  if (d.stairsItemsMode === 'all') {
    access.stairsItems = 'TODOS'
    access.stairsAll = true
    access.stairsInventory = []
  } else if (d.stairsItemsMode === 'list' && d.stairsInventory.length) {
    // Solo elementos realmente presentes en la ficha, con cantidades limitadas a lo declarado.
    const current = new Map(next.items.map(item => [item.catalogItemId, item.quantity]))
    const valid = d.stairsInventory.filter(item => current.has(item.catalogItemId) && item.quantity <= current.get(item.catalogItemId)!)
    if (valid.length === d.stairsInventory.length) {
      access.stairsItems = d.stairsItemsDetail || 'Artículos indicados por el cliente'
      access.stairsAll = false
      access.stairsInventory = valid
    }
  }
  next.intake.tommyAccess = access
  if (d.unresolved?.length) {
    next.pendingInventory = d.unresolved.map(sourceLabel=>({sourceLabel,quantity:1,question:`Artículo por precisar: ${sourceLabel}`,suggestions:[]}))
  }
  next.confirmed = false
  next.intake.stage = 'review'
  return next
}

export type QuoteGap = 'direcciones' | 'inventario' | 'fecha' | 'escaleras' | 'acarreo' | 'embalaje' | 'accesos'
/** Sólo son obligatorios los datos que afectan el precio o un servicio solicitado. */
export function rawQuoteGaps(state: QuoteSessionState): QuoteGap[] {
  const gaps: QuoteGap[] = []
  const hasAddress = (a: QuoteSessionState['origin']['address']) => Boolean(a.street && a.number && a.commune)
  if (!hasAddress(state.origin.address) || !hasAddress(state.destination.address)) gaps.push('direcciones')
  if (!state.items.length || state.pendingInventory.length > 0) gaps.push('inventario')
  if (!state.schedule.date) gaps.push('fecha')
  const answered = new Set(state.intake?.tommyAnswers || [])
  if (!answered.has('escaleras')) gaps.push('escaleras')
  if (!answered.has('acarreo')) gaps.push('acarreo')
  if (!answered.has('embalaje')) gaps.push('embalaje')
  const access = state.intake?.tommyAccess || {}
  const stairsSubset = (access.stairsInventory || [])
  const currentItems = new Map(state.items.map(item => [item.catalogItemId, item.quantity]))
  const invalidStairInventory = Boolean(access.stairsItems && !access.stairsAll && (
    !stairsSubset.length || stairsSubset.some(item => !currentItems.has(item.catalogItemId) || item.quantity > currentItems.get(item.catalogItemId)!)
  ))
  if (answered.has('escaleras') && (
    access.originStairs === undefined || access.destinationStairs === undefined ||
    (access.originStairs && (access.originFloors === undefined || state.origin.details.hasElevator === null)) ||
    (access.destinationStairs && (access.destinationFloors === undefined || state.destination.details.hasElevator === null)) ||
    ((access.originStairs || access.destinationStairs) && (!access.stairsItems || invalidStairInventory))
  )) gaps.push('accesos')
  // No decir que se sabe el acarreo si se conoce un «sí» o una distancia genérica
  // pero no se conoce la ubicación y los metros de cada extremo.
  if (answered.has('acarreo') && state.intake?.tommyDetails?.acarreo !== 'No' &&
      (state.origin.details.parkingDistance === null || state.destination.details.parkingDistance === null)) {
    if (!gaps.includes('acarreo')) gaps.push('acarreo')
  }
  if (answered.has('embalaje') && state.additionalServices.packing &&
      (!state.intake?.tommyDetails?.embalaje || state.intake.tommyDetails.embalaje === 'Sí')) {
    if (!gaps.includes('embalaje')) gaps.push('embalaje')
  }
  return gaps
}

function accessQuestions(state: QuoteSessionState): string[] {
  const access = state.intake?.tommyAccess || {}
  const questions: string[] = []
  if (access.originStairs === undefined || access.destinationStairs === undefined) {
    const ends = [access.originStairs === undefined ? 'origen' : '', access.destinationStairs === undefined ? 'destino' : ''].filter(Boolean)
    questions.push(`¿Se usarán escaleras en ${ends.join(' y ')}? (Sí/No)`)
  }
  for (const [key, label] of [['origin', 'origen'], ['destination', 'destino']] as const) {
    if (access[key === 'origin' ? 'originStairs' : 'destinationStairs']) {
      if (access[key === 'origin' ? 'originFloors' : 'destinationFloors'] === undefined) questions.push(`¿Cuántos pisos por escalera en ${label}?`)
      if (state[key].details.hasElevator === null) questions.push(`¿Hay ascensor utilizable en ${label}? (Sí/No)`)
    }
  }
  if ((access.originStairs || access.destinationStairs) && (
    !access.stairsItems || (!access.stairsAll && (!(access.stairsInventory || []).length || (access.stairsInventory || []).some(item =>
      !state.items.some(current => current.catalogItemId === item.catalogItemId && current.quantity >= item.quantity)
    )))
  )) questions.push('¿Qué muebles pasan por escalera? (TODOS o cuáles)')
  return questions
}

export function nextShortQuestion(state: QuoteSessionState) {
  const gaps = rawQuoteGaps(state)
  const parts: string[] = []
  if (gaps.includes('direcciones')) parts.push('las direcciones completas')
  if (gaps.includes('inventario')) parts.push('los muebles y cantidades')
  if (gaps.includes('fecha')) parts.push('la fecha')
  if (gaps.includes('escaleras') && !gaps.includes('accesos')) parts.push('si se usan escaleras, dónde, cuántos pisos y qué muebles')
  if (gaps.includes('accesos')) parts.push(...accessQuestions(state))
  if (gaps.includes('acarreo')) {
    const a = state.origin.details.parkingDistance, b = state.destination.details.parkingDistance
    const stored = state.intake?.tommyDetails?.acarreo
    if (a === null && b === null && stored && stored !== 'Sí' && stored !== 'No') parts.push(`Ya tengo «${stored}». ¿Son metros en origen, destino o ambos? Indica 0 m en el otro lugar.`)
    else parts.push('¿Cuántos metros se caminan entre el camión y la puerta en origen y destino? (0 si ninguno)')
  }
  if (gaps.includes('embalaje')) parts.push('¿Qué artículos hay que embalar? (o No)')
  return `😊 Para calcular sin suponer datos, me falta:
${parts.map((part, i) => `${i + 1}) ${part}`).join('\n')}
Puedes responder con los números o en tus palabras.`
}
