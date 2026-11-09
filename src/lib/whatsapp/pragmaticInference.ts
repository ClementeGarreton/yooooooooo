/**
 * Implicaturas conversacionales verificables, no «adivinación».
 * GPT interpreta el sentido general; estas reglas SOLO completan consecuencias
 * suficientemente ancladas en el enunciado y el contexto de preguntas activas.
 * Un campo sin evidencia permanece pendiente. Sin nuevas tablas ni servicios.
 */
import type { QuoteSessionState } from '@/lib/quoteSession'

type Side = 'origin' | 'destination'
export type PragmaticEvidence = { field: string; reason: string }

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}
function accessContext(questions: string[]): boolean {
  return questions.some(q => /ascensor|escalera|piso|casa|departamento|acceso/i.test(normalize(q)))
}
function put<T>(record: T, side: Side, key: keyof QuoteSessionState[Side]['details'], value: unknown,
  evidence: PragmaticEvidence[], reason: string) {
  const details = (record as QuoteSessionState)[side].details as unknown as Record<string, unknown>
  if (details[key] !== null && details[key] !== undefined) return
  details[key] = value
  evidence.push({ field: `${side}.details.${key}`, reason })
}

/** Aplica una inferencia únicamente cuando la frase justifica ese dato concreto. */
export function applyGroundedImplicatures(
  state: QuoteSessionState,
  rawText: string,
  activeQuestions: string[] = [],
): { state: QuoteSessionState; evidence: PragmaticEvidence[] } {
  const next = structuredClone(state)
  const evidence: PragmaticEvidence[] = []
  const text = normalize(rawText)

  // «Departamento y casa, respectivamente» responde a origen y destino en ese orden.
  // La palabra «respectivamente» aporta la correspondencia; sin ella no asignamos.
  if (accessContext(activeQuestions) && /\brespectivamente\b/.test(text)) {
    const match = text.match(/\b(departamento|casa|oficina|bodega)\s+y\s+(departamento|casa|oficina|bodega)\b[^.\n]{0,60}\brespectivamente\b/)
    if (match) {
      put(next, 'origin', 'propertyType', match[1], evidence, 'Correspondencia explícita: respectivamente')
      put(next, 'destination', 'propertyType', match[2], evidence, 'Correspondencia explícita: respectivamente')
    }
  }

  // Si el cliente indica expresamente una vivienda de una planta sin escaleras,
  // la carga se realiza a nivel de entrada. Una casa sola no alcanza para concluirlo.
  const singleGroundFloor = /\b(?:planta baja|planta unica|una sola planta|un solo piso|1 piso|un piso)\b/.test(text)
    && /\b(?:sin escaleras|sin escalones|a nivel de calle|planta baja|una sola planta)\b/.test(text)
  if (singleGroundFloor) {
    const candidates = (['origin','destination'] as const).filter(side => next[side].details.propertyType === 'casa')
    const directed = /\b(?:destino|llegada|entrega)\b/.test(text) ? 'destination'
      : /\b(?:origen|salida|retiro)\b/.test(text) ? 'origin' : null
    const side = directed && candidates.includes(directed) ? directed : candidates.length === 1 ? candidates[0] : null
    if (side) {
      // Si el modelo interpretó «casa de un piso» como piso 1, la precisión
      // posterior «sin escaleras» aclara que la carga es en planta baja.
      if (next[side].details.floor === 1) {
        next[side].details.floor = 0
        evidence.push({ field: `${side}.details.floor`, reason: 'Corrección semántica: única planta sin escaleras' })
      }
      put(next, side, 'floor', 0, evidence, 'Una planta a nivel de entrada, sin escaleras')
      put(next, side, 'hasElevator', false, evidence, 'No es necesario ascensor para una planta a nivel de entrada')
    }
  }

  // «El camión queda en la misma entrada» = 0 metros de acarreo en ese extremo.
  // Nunca se aplica a AMBOS lugares si el cliente no lo indica explícitamente.
  if (/\b(?:misma entrada|junto a la (?:puerta|entrada)|pegado a la (?:puerta|entrada)|no (?:hay que|tenemos que) caminar)\b/.test(text)) {
    const side = /\b(?:destino|llegada|descarga)\b/.test(text) && !/\b(?:origen|salida|carga)\b/.test(text)
      ? 'destination'
      : /\b(?:origen|salida)\b/.test(text) && !/\b(?:destino|llegada|descarga)\b/.test(text) ? 'origin' : null
    if (side) put(next, side, 'parkingDistance', 0, evidence, 'El vehículo queda junto a la entrada')
  }

  // «Ambas comunas son Las Condes» es un dato para los dos extremos, no una suposición.
  const both = /\b(?:ambas?\s+(?:comunas?|direcciones?)|los dos lugares)\b/.test(text)
  if (both && /\blas condes\b/.test(text)) {
    for (const side of ['origin','destination'] as const) {
      if (!next[side].address.commune) {
        next[side].address.commune = 'Las Condes'
        evidence.push({ field: `${side}.address.commune`, reason: 'Ambas comunas indicadas expresamente' })
      }
      if (!next[side].address.region) {
        next[side].address.region = 'metropolitana'
        evidence.push({ field: `${side}.address.region`, reason: 'Comuna Las Condes pertenece a RM' })
      }
    }
  }

  // Respuestas telegráficas alineadas con las preguntas 5–8 realmente enviadas.
  // No atribuir «no gracias» a un campo si faltan las otras líneas/orden.
  const secondBatch = activeQuestions.length === 4 && /^¿hay ascensor o escalera/i.test(normalize(activeQuestions[0]))
  const lines = rawText.split(/\n+/).map(v => normalize(v.trim())).filter(Boolean)
  if (secondBatch && lines.length === 4) {
    const no = (v: string) => /^(?:no|ninguno|ninguna|para nada)(?:\s+gracias|\s+tampoco|[.!,\s])*$/i.test(v)
    const answered = new Set(next.intake?.answeredQuoteFields || [])
    if (no(lines[2]) && !answered.has('packing')) {
      next.additionalServices.packing = false; answered.add('packing')
      evidence.push({ field: 'additionalServices.packing', reason: 'Negación en respuesta 7 (embalaje)' })
    }
    if (no(lines[3])) {
      for (const key of ['assembly','disassembly'] as const) {
        if (!answered.has(key)) {
          next.additionalServices[key] = false; answered.add(key)
          evidence.push({ field: `additionalServices.${key}`, reason: 'Negación en respuesta 8 (armado/desarmado)' })
        }
      }
    }
    if (next.intake) next.intake.answeredQuoteFields = [...answered]
  }
  return { state: next, evidence }
}
