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
  'stairsAnswer','stairsDetail','carryAnswer','carryDetail','packingAnswer','packingDetail',
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
  carryAnswer: boolean | null; carryDetail: string | null
  packingAnswer: boolean | null; packingDetail: string | null
  inventoryAction: 'none' | 'replace' | 'add'
  inventory: Array<{ catalogItemId: string; quantity: number; source: string }>
  unresolved: string[]
}
const strings = ['originStreet','originNumber','originCommune','originRegion','destinationStreet','destinationNumber','destinationCommune','destinationRegion','date','time','stairsDetail','carryDetail','packingDetail']
const numbers = ['originFloor','destinationFloor','originParkingMeters','destinationParkingMeters']
const bools = ['originElevator','destinationElevator','stairsAnswer','carryAnswer','packingAnswer']
const props: Record<string, unknown> = {}
for (const k of strings) props[k] = { type: ['string','null'] }
for (const k of numbers) props[k] = { type: ['number','null'] }
for (const k of bools) props[k] = { type: ['boolean','null'] }
props.inventoryAction = { type: 'string', enum: ['none','replace','add'] }
props.inventory = { type: 'array', items: { type: 'object', additionalProperties: false,
  properties: { catalogItemId: {type:'string'}, quantity:{type:'integer'}, source:{type:'string'} },
  required: ['catalogItemId','quantity','source'] } }
props.unresolved = { type:'array', items: { type:'string' } }
const schema = { type: 'object', additionalProperties: false, properties: props,
  required: [...fields, 'inventory', 'unresolved'] }

function compact(state: QuoteSessionState) {
  return {
    origin: state.origin, destination: state.destination, schedule: state.schedule,
    items: state.items, serviceAnswers: state.intake?.tommyAnswers || [],
    serviceDetails: state.intake?.tommyDetails || {}, packing: state.additionalServices.packing,
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
Interpreta frases naturales y respuestas numeradas. Si escribe "50mts", es una distancia de carga de 50 metros.
Si dice "no hay escaleras", stairsAnswer=false. Si dice "5 pisos en origen" originFloor=5.
"Ascensor" y "escaleras" son cosas diferentes. No inventes ascensores a partir del piso.
Respeta las palabras "origen", "destino", "ambos" y los nombres de comunas; solo llena lados indicados inequívocamente.
Conserva lo conocido: en la salida, los campos NO mencionados en este turno deben ser null.
Una negación explícita para un servicio es false, ausencia de respuesta es null.
Para escaleras/acarreo/embalaje, devuelve respuesta y detalle; registra metros si se mencionan, sin inferir una ubicación no dicha.
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
  assign(next.origin.details,'parkingDistance',d.originParkingMeters)
  assign(next.destination.details,'parkingDistance',d.destinationParkingMeters)
  if (d.carryAnswer === false) {
    next.origin.details.parkingDistance = next.origin.details.parkingDistance ?? 0
    next.destination.details.parkingDistance = next.destination.details.parkingDistance ?? 0
  }
  if (d.packingAnswer !== null) next.additionalServices.packing = d.packingAnswer
  next.intake ||= { stage:'describe', serviceAnswers: [], tommyVersion: 1, tommyAnswers:[], tommyDetails:{} }
  const marked = new Set(next.intake.tommyAnswers || [])
  const details = {...next.intake.tommyDetails}
  if (d.stairsAnswer !== null || d.stairsDetail) {
    marked.add('escaleras'); details.escaleras = d.stairsAnswer === false ? 'No' : (d.stairsDetail || (d.stairsAnswer ? 'Sí' : 'Por confirmar'))
  }
  if (d.carryAnswer !== null || d.carryDetail || d.originParkingMeters !== null || d.destinationParkingMeters !== null) {
    marked.add('acarreo'); details.acarreo = d.carryDetail || (d.carryAnswer ? 'Sí' : 'No')
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
  if (d.unresolved?.length) {
    next.pendingInventory = d.unresolved.map(sourceLabel=>({sourceLabel,quantity:1,question:`Artículo por precisar: ${sourceLabel}`,suggestions:[]}))
  }
  next.confirmed = false
  next.intake.stage = 'review'
  return next
}

export type QuoteGap = 'direcciones'|'inventario'|'fecha'|'escaleras'|'acarreo'|'embalaje'
export function rawQuoteGaps(state: QuoteSessionState): QuoteGap[] {
  const gaps: QuoteGap[] = []
  const hasAddress = (a: QuoteSessionState['origin']['address'])=> Boolean(a.street && a.number && a.commune)
  if (!hasAddress(state.origin.address) || !hasAddress(state.destination.address)) gaps.push('direcciones')
  if (!state.items.length || state.pendingInventory.length > 0) gaps.push('inventario')
  if (!state.schedule.date) gaps.push('fecha')
  const answered = new Set(state.intake?.tommyAnswers || [])
  if (!answered.has('escaleras')) gaps.push('escaleras')
  if (!answered.has('acarreo')) gaps.push('acarreo')
  if (!answered.has('embalaje')) gaps.push('embalaje')
  return gaps
}

const labels: Record<QuoteGap,string> = {
  direcciones: 'origen y destino', inventario:'muebles y cantidades',
  fecha:'fecha', escaleras:'escaleras (sí/no, pisos)',
  acarreo:'distancia de carga', embalaje:'embalaje (sí/no, muebles)',
}
export function nextShortQuestion(state: QuoteSessionState) {
  const gaps = rawQuoteGaps(state)
  const requested = gaps.map(g=>labels[g]).join('; ')
  return `Solo me falta: ${requested}. Puedes responder en un mensaje. 😊`
}
