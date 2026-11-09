/**
 * Único ciclo de WhatsApp: texto libre -> NLP estructurado -> quote_sessions.state ->
 * preguntas AGRUPADAS por TODOS los datos faltantes del cotizador web.
 * Los valores ausentes son null; "No" es false; 0 es una respuesta válida.
 */
import type { QuoteSessionState, PropertyType } from '@/lib/quoteSession'
import { createStructuredResponseWithUsage } from '@/lib/ai/openai'
import { supabaseAdmin } from '@/lib/supabase'

type Stop = { street: string; number: string; commune: string; region: string; additionalInfo: string; note: string }
type ItemExtraction = { catalogItemId: string; quantity: number; source: string }

type Data = {
  name: string | null; email: string | null; rut: string | null; taxDocument: 'boleta' | 'factura' | null
  companyName: string | null; companyRut: string | null
  date: string | null; time: string | null; isFlexible: boolean | null
  originStreet: string | null; originNumber: string | null; originCommune: string | null; originRegion: string | null; originAdditionalInfo: string | null
  destinationStreet: string | null; destinationNumber: string | null; destinationCommune: string | null; destinationRegion: string | null; destinationAdditionalInfo: string | null
  originPropertyType: PropertyType | null; destinationPropertyType: PropertyType | null
  originFloor: number | null; destinationFloor: number | null
  originElevator: boolean | null; destinationElevator: boolean | null
  originParkingMeters: number | null; destinationParkingMeters: number | null
  stopsSpecified: boolean | null; stops: Stop[]
  inventoryAction: 'none' | 'replace' | 'add'; inventory: ItemExtraction[]; unresolved: string[]
  disassembly: boolean | null; assembly: boolean | null; packing: boolean | null; unpacking: boolean | null
  extraHelpers: number | null; fridgeDisassembly: boolean | null; priority: boolean | null; stairsCarry: boolean | null
  observations: string | null
  // Compatibilidad con los mensajes antiguos de seis preguntas.
  stairsAnswer: boolean | null; stairsDetail: string | null
  carryAnswer: boolean | null; carryDetail: string | null
  packingAnswer: boolean | null; packingDetail: string | null
}

const strings = [
  'name','email','rut','companyName','companyRut','date','time',
  'originStreet','originNumber','originCommune','originRegion','originAdditionalInfo',
  'destinationStreet','destinationNumber','destinationCommune','destinationRegion','destinationAdditionalInfo',
  'observations','stairsDetail','carryDetail','packingDetail',
] as const
const numbers = ['originFloor','destinationFloor','originParkingMeters','destinationParkingMeters','extraHelpers'] as const
const bools = [
  'isFlexible','originElevator','destinationElevator','stopsSpecified','disassembly','assembly','packing','unpacking',
  'fridgeDisassembly','priority','stairsCarry','stairsAnswer','carryAnswer','packingAnswer',
] as const
const props: Record<string,unknown> = {}
for (const k of strings) props[k] = { type:['string','null'] }
for (const k of numbers) props[k] = { type:['number','null'] }
for (const k of bools) props[k] = { type:['boolean','null'] }
for (const k of ['originPropertyType','destinationPropertyType']) props[k] = { type:['string','null'], enum:['casa','departamento','oficina','bodega','otro',null] }
props.taxDocument = { type:['string','null'], enum:['boleta','factura',null] }
props.inventoryAction = { type:'string', enum:['none','replace','add'] }
props.inventory = { type:'array', items:{ type:'object', additionalProperties:false, properties:{
  catalogItemId:{type:'string'}, quantity:{type:'integer'}, source:{type:'string'},
}, required:['catalogItemId','quantity','source'] } }
props.unresolved = { type:'array', items:{ type:'string' } }
props.stops = { type:'array', items:{ type:'object', additionalProperties:false, properties:{
  street:{type:'string'},number:{type:'string'},commune:{type:'string'},region:{type:'string'},
  additionalInfo:{type:'string'},note:{type:'string'},
},required:['street','number','commune','region','additionalInfo','note'] } }
const schema = { type:'object', additionalProperties:false, properties:props, required:Object.keys(props) }

export const QUOTE_INTAKE_QUESTIONS = [
  '¡Hola! 👋 Cuéntame tu mudanza como te resulte más cómodo; puedes responder todo en un solo mensaje.',
  '',
  '¿Cuál es tu nombre y correo? ¿Quieres boleta o factura? Si es factura, incluye razón social y RUT.',
  '¿Qué día y a qué hora te acomoda? ¿Tienes flexibilidad de fecha?',
  '¿De dónde a dónde trasladamos? Indica calle, número, comuna y, si corresponde, departamento. En ambos lugares, ¿es casa, departamento, oficina o bodega? ¿En qué piso, con o sin ascensor, y a cuántos metros del acceso puede estacionar el camión?',
  '¿Qué muebles, cajas y otros artículos llevas y cuántos de cada uno? ¿Hay alguna parada intermedia para cargar o descargar?',
  '¿Necesitas desarmado, armado, embalaje o desembalaje? ¿Hay objetos que deban subir o bajar por escalera aunque exista ascensor? ¿Necesitas desarmar un refrigerador, ayudantes adicionales o servicio prioritario? Si hay algún detalle importante, inclúyelo.',
  '',
  'Si algún servicio no lo necesitas, basta con decir «no». Con tu respuesta prepararé el precio y solo preguntaré junto lo que falte. 🚚',
].join('\n')

function compact(state:QuoteSessionState) {
  return {
    personalInfo:state.personalInfo, taxDocument:state.taxDocument, schedule:state.schedule,
    origin:state.origin, destination:state.destination, stops:state.stops ?? [],
    stopsAnswered:state.intake?.answeredQuoteFields?.includes('stops') || false,
    items:state.items, services:state.additionalServices,
    answeredFields:state.intake?.answeredQuoteFields || [],
    legacyServiceAnswers:state.intake?.tommyAnswers || [],
  }
}

export async function parseRawCustomerQuote(state:QuoteSessionState, rawMessage:string, currentQuestions: string[] = []) {
  const {data:catalog,error} = await supabaseAdmin.from('catalog_items')
    .select('id,name,category').eq('is_active',true).order('name')
  if (error) throw new Error(`Catálogo no disponible: ${error.message}`)
  const rows = (catalog || []).map((r:any)=>({id:String(r.id), name:String(r.name), category:String(r.category || '')}))
  const ids = new Set(rows.map((r: {id:string})=>r.id))
  const {data,usage} = await createStructuredResponseWithUsage<Data>({
    model:process.env.OPENAI_NLP_MODEL || 'gpt-6.1-sol', reasoningEffort:'low',ignoreGlobalReasoningEffort:true,
    schemaName:'whatsapp_full_quote_nlp', schema, maxOutputTokens:5200,
    instructions:`Eres un intérprete semántico para el cotizador de Yo Me Encargo en Chile.
Tu ÚNICA función es extraer datos nuevos del texto crudo del cliente hacia el esquema completo del quoteStore web.
No redactes preguntas; el servidor compara cada variable con el estado guardado.
No completes por defecto: un servicio no mencionado es null, NO false; un piso desconocido es null, NO 0.
0, false y el texto "no" son respuestas válidas. No infieras un ascensor por la existencia de pisos.
Si el cliente dice "ningún servicio adicional", marca todos los servicios opcionales false y ayudantes extra 0. Si responde NO a una pregunta que combina armado y desarmado, marca disassembly=false y assembly=false. Si responde NO a una pregunta de embalaje, marca packing=false y packingAnswer=false. Si nombra qué muebles hay que armar o desarmar, conserva sus nombres en observations y no cambies el inventario por ello. Si un inmueble es una casa, NO presupongas qué pisos o escaleras se utilizan: extrae los pisos solo si están expresamente indicados.
Si el cliente responde DIRECTO a la pregunta de paradas, stopsSpecified=false y stops=[]. Si responde NO a una pregunta que enumera servicios extras, marca en false o 0 TODOS los servicios enumerados en esa pregunta, y deja los demás campos sin modificar. Si dice "no hay paradas intermedias", stopsSpecified=false y stops=[]. Si da paradas con dirección completa, stopsSpecified=true y stops=[...]. Si menciona una parada pero faltan sus datos, stopsSpecified=null y stops=[].
Si una ubicación no incluye departamento o instrucciones adicionales, deja additionalInfo null; no es requisito si no aplica.
Las preguntas iniciales se envían en DOS mensajes sin «Respuesta:»; el cliente responde de forma libre.
Si el cliente copia una plantilla antigua con "Respuesta:", SOLO interpreta lo escrito DESPUÉS de ese marcador.
REGLA DE IMPLICATURAS: interpreta referencias contextuales como «en origen piso 5, sí hay ascensor, en destino casa, piso 0» sin exigir repetir el sujeto. Usa las preguntas recientes para interpretar respuestas telegráficas en el mismo orden. «Tampoco», «ya lo dije», «no necesito», «ninguno» niegan servicios ya mencionados en esa conversación; nunca los conviertas en objetos.
Si se dan una vivienda casa en planta baja o piso 0, anota floor=0 y hasElevator=false como valor operativo (no se usará ascensor para la carga), pero NO extrapoles eso a otra planta. En un departamento piso 5, «sí hay ascensor» refiere al departamento salvo indicación contraria.
Si el cliente dice «no entiendo la pregunta», NO trates esa frase ni el texto de la pregunta como artículo de inventario. El servidor le explicará la pregunta de otra forma. Extrae el resto de las respuestas del mensaje sin perderlas.
Al contestar «no» al embalaje o al armado/desarmado en conjunto, marca los servicios respectivos falsos, aunque use otras palabras o esté negando una pregunta ya contestada.
Solo crea unresolved para NOMBRES DE ARTÍCULOS REALES que el cliente intenta trasladar. Jamás pongas textos sobre escaleras, ascensor, estacionamientos, pisos o preguntas en unresolved; inventoryAction=none si no hay inventario nuevo. 
Cuando la comuna permite inferir inequívocamente la región (ej.: Las Condes = Metropolitana) normalízala.
Admite frases, erratas, numeraciones y modificaciones posteriores. Solo extrae campos NUEVOS o CORREGIDOS en este turno;
los no mencionados van en null, inventario en [], stops en []. La información vieja se preserva automáticamente.
No alteres un inventario existente si el cliente alude a un artículo solo como contexto; inventoryAction=none en ese caso.
Para inventario completo o formulario copiado, inventoryAction=replace; si explícitamente añade cosas, add.
Usa solo IDs de catálogo válidos. Si un artículo no existe, añádelo a unresolved, jamás inventes su ID.
La fecha actual en Chile es ${new Date().toLocaleDateString('en-CA',{timeZone:'America/Santiago'})}; normaliza fecha YYYY-MM-DD, hora HH:mm.
El campo parkingDistance es distancia real en metros desde el camión al acceso EN CADA EXTREMO (0 si responde sin acarreo).
El campo stairsCarry señala bultos que deben ir por escalera A PESAR de existir ascensor; no equivale a piso.
Datos de empresa son necesarios solamente para factura. No inventes nombre, e-mail o RUT. Extrae el RUT personal en rut; el de empresa va solo en companyRut. Si hay un mensaje 'Pregunta N: respuesta', N corresponde EXCLUSIVAMENTE a la pregunta N de 'Preguntas del último mensaje del bot'; no uses la numeración de otro formulario.
No inventes precio, volumen, peso, viaje ni recargos. Los calcula el motor del cotizador web.
Catálogo válido: ${JSON.stringify(rows)}
Preguntas VIGENTES en el orden en que se enviaron (usa estas y SOLO estas si el usuario responde «primera», «segunda» o por números): ${JSON.stringify(currentQuestions)}
Estado previo (contexto, NO copiar como nuevas respuestas): ${JSON.stringify(compact(state))}`,
    input:[{role:'user',content:rawMessage}],
  })
  data.inventory = data.inventory.filter(i=>ids.has(i.catalogItemId) && Number.isInteger(i.quantity) && i.quantity > 0 && i.quantity <= 100)
  // El NLP no puede crear un artículo a partir de una aclaración de accesos.
  if (data.inventoryAction === 'none') { data.inventory = []; data.unresolved = [] }
  data.unresolved = data.unresolved.filter(label =>
    !/(?:ascensor|piso|estacionamiento|pregunta|respuesta|origen|destino)/i.test(label)).slice(0, 15)
  data.stops = data.stops.filter(s=>s.street && s.number && s.commune).slice(0,10)
  return {data,usage}
}

function assign<T extends object,K extends keyof T>(target:T,key:K,value:T[K] | null) {
  if (value !== null && value !== undefined && (typeof value !== 'string' || value.trim())) target[key]=value
}

export function mergeRawQuote(state:QuoteSessionState,d:Data):QuoteSessionState {
  const next:QuoteSessionState = structuredClone(state)
  next.intake ||= {stage:'describe',serviceAnswers:[],tommyVersion:1,tommyAnswers:[],tommyDetails:{}}
  const answered = new Set(next.intake.answeredQuoteFields || [])
  const mark = (key:string,value:unknown) => {if(value !== null && value !== undefined) answered.add(key)}
  assign(next.personalInfo,'name',d.name); assign(next.personalInfo,'email',d.email); assign(next.personalInfo,'rut',d.rut)
  if (d.taxDocument) {next.taxDocument=d.taxDocument;next.personalInfo.isCompany=d.taxDocument === 'factura';mark('taxDocument',d.taxDocument)}
  assign(next.personalInfo,'companyName',d.companyName);assign(next.personalInfo,'companyRut',d.companyRut)
  assign(next.schedule,'date',d.date);assign(next.schedule,'time',d.time)
  assign(next.schedule,'isFlexible',d.isFlexible);mark('isFlexible',d.isFlexible)
  // Si el cliente dio su RUT personal y no solicita facturar a una empresa,
  // el comprobante operativo para consumidor es boleta (implicatura habitual).
  if (!next.taxDocument && next.personalInfo.rut?.trim() && !next.personalInfo.isCompany &&
    !d.companyName && !d.companyRut) {
    next.taxDocument = 'boleta'; answered.add('taxDocument')
  }
  for (const side of ['origin','destination'] as const) {
    const origin = side === 'origin'
    const address=next[side].address, details=next[side].details
    assign(address,'street',origin?d.originStreet:d.destinationStreet)
    assign(address,'number',origin?d.originNumber:d.destinationNumber)
    assign(address,'commune',origin?d.originCommune:d.destinationCommune)
    assign(address,'region',origin?d.originRegion:d.destinationRegion)
    assign(address,'additionalInfo',origin?d.originAdditionalInfo:d.destinationAdditionalInfo)
    assign(details,'propertyType',origin?d.originPropertyType:d.destinationPropertyType)
    assign(details,'floor',origin?d.originFloor:d.destinationFloor)
    assign(details,'hasElevator',origin?d.originElevator:d.destinationElevator)
    assign(details,'parkingDistance',origin?d.originParkingMeters:d.destinationParkingMeters)
    // Planta baja de casa: el ascensor no interviene en el traslado.
    if (details.propertyType === 'casa' && details.floor === 0 && details.hasElevator === null) {
      details.hasElevator = false
    }
  }
  if (d.carryAnswer === false) {
    next.origin.details.parkingDistance ??= 0
    next.destination.details.parkingDistance ??= 0
  }
  if (d.stopsSpecified !== null && d.stopsSpecified !== undefined && (!d.stopsSpecified || d.stops.length > 0)) {
    next.stops = d.stopsSpecified ? d.stops : []
    answered.add('stops')
  }
  for (const key of ['disassembly','assembly','packing','unpacking','fridgeDisassembly','priority','stairsCarry','extraHelpers'] as const) {
    assign(next.additionalServices,key,d[key]);mark(key,d[key])
  }
  if (d.packingAnswer !== null) {next.additionalServices.packing=d.packingAnswer;mark('packing',d.packingAnswer)}
  if (d.observations !== null) {
    next.additionalServices.observations=d.observations.trim() || ''
    answered.add('observations')
  }
  const marked=new Set(next.intake.tommyAnswers||[])
  const details={...next.intake.tommyDetails}
  if (d.stairsAnswer!==null || d.stairsDetail) {
    marked.add('escaleras')
    details.escaleras=d.stairsAnswer===false?'No':(d.stairsDetail || (d.stairsAnswer?'Sí':'Por confirmar'))
  }
  if (d.carryAnswer!==null || d.carryDetail || d.originParkingMeters!==null || d.destinationParkingMeters!==null) {
    marked.add('acarreo');details.acarreo=d.carryDetail || (d.carryAnswer===false?'No':'Sí')
  }
  if (d.packingAnswer!==null || d.packing!==null || d.packingDetail) {
    marked.add('embalaje');details.embalaje=d.packingDetail || ((d.packing ?? d.packingAnswer)?'Sí':'No')
    if (d.packingDetail && d.observations===null) {
      next.additionalServices.observations=[next.additionalServices.observations==='__pending__'?'':next.additionalServices.observations,d.packingDetail].filter(Boolean).join('; ')
    }
  }
  next.intake.tommyDetails=details
  next.intake.tommyAnswers=[...marked]
  if (d.inventoryAction !== 'none') {
    const selected=new Map<string,number>()
    if (d.inventoryAction==='add') for (const item of next.items) selected.set(item.catalogItemId,item.quantity)
    for (const item of d.inventory) selected.set(item.catalogItemId,item.quantity)
    if (selected.size) {
      next.items=[...selected.entries()].map(([catalogItemId,quantity])=>({catalogItemId,quantity}))
      next.inventoryCollectionDone=true
    }
    next.pendingInventory=d.unresolved.map(sourceLabel=>({sourceLabel,quantity:1,question:`Artículo por precisar: ${sourceLabel}`,suggestions:[]}))
  } else if (d.unresolved.length) {
    next.pendingInventory=d.unresolved.map(sourceLabel=>({sourceLabel,quantity:1,question:`Artículo por precisar: ${sourceLabel}`,suggestions:[]}))
  }
  // Limpieza de falsos «artículos» de sesiones anteriores: texto de preguntas.
  next.pendingInventory = next.pendingInventory.filter(p =>
    !/(?:ascensor|piso|estacionamiento|pregunta|respuesta|origen|destino)/i.test(p.sourceLabel))
  if (next.additionalServices.observations === '__pending__') next.additionalServices.observations = ''
  next.intake.answeredQuoteFields=[...answered]
  next.confirmed=false
  next.intake.stage='review'
  return next
}

export type QuoteGap =
  | 'name'|'email'|'taxDocument'|'companyName'|'companyRut'|'date'|'time'|'isFlexible'
  | 'originAddress'|'destinationAddress'|'originPropertyType'|'destinationPropertyType'
  | 'originFloor'|'destinationFloor'|'originElevator'|'destinationElevator'
  | 'originParkingMeters'|'destinationParkingMeters'|'stops'|'inventory'
  | 'disassembly'|'assembly'|'packing'|'unpacking'|'fridgeDisassembly'
  | 'priority'|'stairsCarry'|'extraHelpers'

export function rawQuoteGaps(state:QuoteSessionState):QuoteGap[] {
  const gaps:QuoteGap[]=[]
  const answered=new Set(state.intake?.answeredQuoteFields || [])
  if (!state.personalInfo.name?.trim()) gaps.push('name')
  if (!state.personalInfo.email?.trim()) gaps.push('email')
  if (!state.taxDocument) gaps.push('taxDocument')
  if (state.taxDocument==='factura' || state.personalInfo.isCompany) {
    if (!state.personalInfo.companyName?.trim()) gaps.push('companyName')
    if (!state.personalInfo.companyRut?.trim()) gaps.push('companyRut')
  }
  if (!state.schedule.date) gaps.push('date')
  if (!state.schedule.time) gaps.push('time')
  if (!answered.has('isFlexible')) gaps.push('isFlexible')
  for (const side of ['origin','destination'] as const) {
    const {address,details}=state[side]
    if (!address.street?.trim() || !address.number?.trim() || !address.commune?.trim() || !address.region?.trim()) gaps.push(`${side}Address` as QuoteGap)
    if (!details.propertyType) gaps.push(`${side}PropertyType` as QuoteGap)
    if (details.floor===null || !Number.isInteger(details.floor) || details.floor < 0) gaps.push(`${side}Floor` as QuoteGap)
    if (details.hasElevator===null) gaps.push(`${side}Elevator` as QuoteGap)
    if (details.parkingDistance===null || !Number.isFinite(details.parkingDistance) || details.parkingDistance < 0) gaps.push(`${side}ParkingMeters` as QuoteGap)
  }
  if (!answered.has('stops')) gaps.push('stops')
  if (!state.items.length || state.pendingInventory.length || state.inventoryPhotos?.some(p=>p.status!=='done')) gaps.push('inventory')
  for (const service of ['disassembly','assembly','packing','unpacking','fridgeDisassembly','priority','stairsCarry','extraHelpers'] as const) {
    const helpers = state.additionalServices.extraHelpers
    const invalidHelpers = service === 'extraHelpers' && (typeof helpers !== 'number' || !Number.isInteger(helpers) || helpers < 0)
    if ((!answered.has(service) || invalidHelpers) && !(service === 'packing' && state.intake?.tommyAnswers?.includes('embalaje'))) gaps.push(service)
  }
  return gaps
}

// Las preguntas se agrupan por temática, pero cada campo pendiente está representado.
const prompts:Record<QuoteGap,string>={
  name:'tu nombre', email:'tu correo', taxDocument:'si quieres boleta o factura',
  companyName:'razón social para la factura',companyRut:'RUT de la empresa',
  date:'fecha del traslado',time:'hora del traslado',isFlexible:'si tienes flexibilidad de fecha',
  originAddress:'dirección completa de origen (calle, número, comuna y región)',
  destinationAddress:'dirección completa de destino (calle, número, comuna y región)',
  originPropertyType:'tipo de inmueble de origen (casa/departamento/oficina/bodega)',
  destinationPropertyType:'tipo de inmueble de destino',
  originFloor:'piso en origen (0 si es planta baja)',destinationFloor:'piso en destino (0 si es planta baja)',
  originElevator:'si hay ascensor en origen',destinationElevator:'si hay ascensor en destino',
  originParkingMeters:'metros entre camión y acceso en origen (0 si no hay acarreo)',
  destinationParkingMeters:'metros entre camión y acceso en destino (0 si no hay acarreo)',
  stops:'si hay paradas intermedias; si hay, dirección y qué se carga/descarga',
  inventory:'inventario completo: artículos y cantidades (incluye cualquier artículo pendiente de identificar)',
  disassembly:'si necesitas desarmado de muebles',assembly:'si necesitas armado de muebles',
  packing:'si necesitas embalaje',unpacking:'si necesitas desembalaje',
  fridgeDisassembly:'si necesitas desarmar un refrigerador (si no corresponde, responde no)',
  priority:'si quieres servicio prioritario',stairsCarry:'si hay bultos que deban subir o bajar por escalera aunque exista ascensor',
  extraHelpers:'cantidad de ayudantes adicionales (0 si ninguno)',
}
const groups:QuoteGap[][]=[
  ['name','email','taxDocument','companyName','companyRut'],
  ['date','time','isFlexible'],
  ['originAddress','originPropertyType','originFloor','originElevator','originParkingMeters'],
  ['destinationAddress','destinationPropertyType','destinationFloor','destinationElevator','destinationParkingMeters'],
  ['inventory','stops'],
  ['disassembly','assembly','packing','unpacking','fridgeDisassembly','priority','stairsCarry','extraHelpers'],
]
export function nextShortQuestion(state:QuoteSessionState):string {
  const missing=new Set(rawQuoteGaps(state))
  if (!missing.size) return 'Ya tengo todos los datos para calcular tu mudanza.'
  const lines=groups.map(group=>group.filter(k=>missing.has(k)).map(k=>prompts[k])).filter(x=>x.length)
  return [
    '¡Gracias! Ya guardé todo lo que me contaste. Para terminar, solo necesito aclarar lo siguiente:',
    '',
    ...lines.map(g=>`• ${g.join('; ')}.`),
    '',
    'Respóndeme todo junto, con tus propias palabras. No hace falta volver a escribir lo anterior. 🚚',
  ].join('\n')
}
