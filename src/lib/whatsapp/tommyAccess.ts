/**
 * Preguntas atómicas sobre accesos. Un «sí» pertenece a UNA pregunta identificada,
 * jamás a una pregunta compuesta sobre ascensor/escalera y ambos inmuebles.
 * Se guarda en quote_sessions.state (JSONB), sin migración.
 */
import type { QuoteSessionState } from '../quoteSession'

export type TommyAccess = {
  originElevator?: boolean
  destinationElevator?: boolean
  originStairs?: boolean
  destinationStairs?: boolean
  stairsItems?: string
  originFloors?: number
  destinationFloors?: number
}

type YesNoKey = 'originElevator' | 'destinationElevator' | 'originStairs' | 'destinationStairs'
export type AccessQuestion = { id: number; label: string; key: keyof TommyAccess; kind: 'binary' | 'text' | 'floors' }
const BINARY: AccessQuestion[] = [
  { id: 1, key: 'originElevator', kind: 'binary', label: '¿Hay ascensor utilizable para los muebles en el origen? (Sí/No)' },
  { id: 2, key: 'destinationElevator', kind: 'binary', label: '¿Hay ascensor utilizable para los muebles en el destino? (Sí/No)' },
  { id: 3, key: 'originStairs', kind: 'binary', label: '¿Hay que mover muebles por escaleras en el origen? (Sí/No)' },
  { id: 4, key: 'destinationStairs', kind: 'binary', label: '¿Hay que mover muebles por escaleras en el destino? (Sí/No)' },
]
const ITEMS: AccessQuestion = { id: 5, key: 'stairsItems', kind: 'text', label: '¿Qué muebles hay que mover por escaleras?' }
const ORIGIN_FLOORS: AccessQuestion = { id: 6, key: 'originFloors', kind: 'floors', label: '¿Cuántos pisos hay que recorrer por escalera en el origen?' }
const DESTINATION_FLOORS: AccessQuestion = { id: 7, key: 'destinationFloors', kind: 'floors', label: '¿Cuántos pisos hay que recorrer por escalera en el destino?' }

const normalize = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
export function unansweredAccess(access: TommyAccess): AccessQuestion[] {
  const result = BINARY.filter(q => access[q.key] === undefined)
  if (access.originStairs || access.destinationStairs) {
    if (!access.stairsItems) result.push(ITEMS)
    if (access.originStairs && access.originFloors === undefined) result.push(ORIGIN_FLOORS)
    if (access.destinationStairs && access.destinationFloors === undefined) result.push(DESTINATION_FLOORS)
  }
  return result
}
export function accessIsComplete(access: TommyAccess | undefined): boolean {
  return Boolean(access && unansweredAccess(access).length === 0)
}
export function accessPendingLines(access: TommyAccess = {}): string[] {
  return unansweredAccess(access).map(q => `  4.${q.id}) ${q.label} | Respuesta:`)
}

/** Identifica el nuevo formato aun si solo se contesta una subpregunta. */
export function isTommyAccessReply(text: string): boolean {
  return /(?:^|\n)\s*4\.[1-7]\s*[).:-]\s*/m.test(text)
}

/** Solo lee cambios DESPUÉS de «Respuesta:», nunca el Sí/No de la pregunta copiada. */
export function extractAccessAnswers(text: string): { id: number; value: string }[] {
  const rows: { id: number; value: string }[] = []
  for (const line of text.replace(/\r/g, '').split('\n')) {
    const match = /^\s*(?:[-•]\s*)?4\.([1-7])\s*[).:-]\s*(.*)$/i.exec(line)
    if (!match) continue
    const marker = /(?:\||;)\s*(?:respuesta|rpta|rta)\s*:\s*(.*)$/i.exec(match[2])
    if (marker) {
      if (marker[1].trim()) rows.push({ id: Number(match[1]), value: marker[1].trim() })
      continue
    }
    // Atajo permitido: «4.1) Sí», pero nunca leer «Sí/No» de la plantilla.
    const short = match[2].trim()
    if (/^(?:s[ií]|no|nop|negativo|afirmativo)[.!\s]*$/i.test(short)) {
      rows.push({ id: Number(match[1]), value: short })
    }
  }
  return rows
}

function parseBinary(value: string): boolean | undefined {
  const v = normalize(value)
  if (/^(?:si|sip|sipo|afirmativo|claro|correcto)(?:\b|[.!;,])/.test(v)) return true
  if (/^(?:no|nop|negativo|ninguno|sin)(?:\b|[.!;,])/.test(v)) return false
  return undefined
}
function parseFloors(value: string): number | undefined {
  const m = /(?:^|\s)(\d{1,2})(?=\s*(?:pisos?|plantas?|niveles?|$|[.,;]))/i.exec(normalize(value))
  if (!m) return undefined
  const n = Number(m[1]); return Number.isInteger(n) && n >= 0 && n <= 50 ? n : undefined
}

export function applyAccessForm(state: QuoteSessionState, text: string): QuoteSessionState {
  if (!state.intake || !isTommyAccessReply(text)) return state
  const next = structuredClone(state)
  const access: TommyAccess = { ...(next.intake?.tommyAccess || {}) }
  const answers = extractAccessAnswers(text)
  const byId = new Map<number, Set<string>>()
  for (const answer of answers) {
    if (!byId.has(answer.id)) byId.set(answer.id, new Set())
    byId.get(answer.id)!.add(normalize(answer.value))
  }
  // Si hay dos respuestas distintas para el mismo número, no elegir arbitrariamente.
  for (const [id, values] of byId) {
    if (values.size !== 1) continue
    const value = answers.find(a => a.id === id)!.value
    const q = [...BINARY, ITEMS, ORIGIN_FLOORS, DESTINATION_FLOORS].find(q => q.id === id)!
    if (q.kind === 'binary') {
      const answer = parseBinary(value)
      if (answer !== undefined) access[q.key as YesNoKey] = answer
    } else if (q.kind === 'text') {
      if (value.length >= 3 && !/^(?:no|si|respuesta|pendiente|sin respuesta)$/i.test(normalize(value))) access.stairsItems = value
    } else {
      const floors = parseFloors(value)
      if (floors !== undefined) access[q.key as 'originFloors' | 'destinationFloors'] = floors
    }
  }
  next.intake!.tommyAccess = access
  if (access.originElevator !== undefined) next.origin.details.hasElevator = access.originElevator
  if (access.destinationElevator !== undefined) next.destination.details.hasElevator = access.destinationElevator
  if (accessIsComplete(access)) {
    const labels = (v: boolean) => v ? 'Sí' : 'No'
    const lines = [
      `Ascensor origen: ${labels(access.originElevator!)}`,
      `Ascensor destino: ${labels(access.destinationElevator!)}`,
      `Escaleras origen: ${labels(access.originStairs!)}`,
      `Escaleras destino: ${labels(access.destinationStairs!)}`,
      ...(access.originStairs || access.destinationStairs ? [`Muebles por escaleras: ${access.stairsItems}`] : []),
      ...(access.originStairs ? [`Pisos por escalera origen: ${access.originFloors}`] : []),
      ...(access.destinationStairs ? [`Pisos por escalera destino: ${access.destinationFloors}`] : []),
    ]
    next.intake!.tommyDetails = { ...next.intake!.tommyDetails, escaleras: lines.join('; ') }
    next.intake!.tommyAnswers = [...new Set([...(next.intake!.tommyAnswers || []), 'escaleras' as const])]
  }
  return next
}
