/**
 * Accesos de mudanza: cada respuesta queda vinculada a una pregunta numerada.
 * La lista inicial de artículos ya se conoce: no volver a exigir el inventario.
 * Este módulo es puro; no depende de LLM, Supabase ni WhatsApp.
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
  { id: 1, key: 'originElevator', kind: 'binary', label: '¿Ascensor en origen? (Sí/No)' },
  { id: 2, key: 'destinationElevator', kind: 'binary', label: '¿Ascensor en destino? (Sí/No)' },
  { id: 3, key: 'originStairs', kind: 'binary', label: '¿Se usarán escaleras en origen? (Sí/No)' },
  { id: 4, key: 'destinationStairs', kind: 'binary', label: '¿Se usarán escaleras en destino? (Sí/No)' },
]
const ITEMS: AccessQuestion = { id: 5, key: 'stairsItems', kind: 'text', label: '¿Qué muebles irán por escalera? (TODOS o solo cuáles)' }
const ORIGIN_FLOORS: AccessQuestion = { id: 6, key: 'originFloors', kind: 'floors', label: '¿Cuántos pisos por escalera en origen?' }
const DESTINATION_FLOORS: AccessQuestion = { id: 7, key: 'destinationFloors', kind: 'floors', label: '¿Cuántos pisos por escalera en destino?' }
const QUESTIONS = [...BINARY, ITEMS, ORIGIN_FLOORS, DESTINATION_FLOORS]

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
  return unansweredAccess(access).map(q => `4.${q.id}) ${q.label} | Respuesta:`)
}

/**
 * La forma abreviada «1 Sí, 2 No» se admite SOLO en contexto de aclaraciones
 * de acceso: nunca se usa para interpretar el primer formulario de cotización.
 */
function compactAccessForm(text: string): boolean {
  const pairs = [...text.matchAll(/(?:^|[\s,;])(?:4\.([1-4])|([1-4]))\s*(?:[).:]|\s+)\s*(s[ií]|sip|sipo|no|nop|afirmativo|negativo)(?=$|[\s,;.!])/gi)]
  if (!pairs.length) return false
  const residual = text.replace(/(?:^|[\s,;])(?:4\.[1-4]|[1-4])\s*(?:[).:]|\s+)\s*(?:s[ií]|sip|sipo|no|nop|afirmativo|negativo)(?=$|[\s,;.!])/gi, '')
    .replace(/[\s,;.!]+/g, '')
  return residual.length === 0
}
export function isTommyAccessReply(text: string, state?: QuoteSessionState): boolean {
  if (/(?:^|\n)\s*(?:[-•]\s*)?4\.[1-7](?:\s*[).:-]|\s+)\s*/m.test(text)) return true
  if (!state?.intake || state.intake.tommyAnswers?.includes('escaleras')) return false
  // Un «1 sí» no se confunde con el campo 1 (direcciones): se exige que el
  // cliente ya haya dado origen, destino, fecha e inventario.
  const hasAddresses = [state.origin.address, state.destination.address].every(
    a => Boolean(a.street && a.number && a.commune))
  if (!hasAddresses || !state.items.length || !state.schedule.date) return false
  if (compactAccessForm(text)) return true
  const pending = unansweredAccess(state.intake.tommyAccess || {})
  return pending.length === 1 && pending[0].kind === 'binary' && /^(?:s[ií]|sip|sipo|no|nop)[.!\s]*$/i.test(text)
}

/**
 * Se leen respuestas solo DESPUÉS de «Respuesta:», nunca el «Sí/No» de una
 * pregunta copiada. También admite «4.2 no» y, con contexto, «2 no».
 */
export function extractAccessAnswers(text: string, state?: QuoteSessionState): { id: number; value: string }[] {
  const rows: { id: number; value: string }[] = []
  // Permitir varias respuestas numeradas en una línea: «4.5 TODOS; 4.7 1».
  const lines = text.replace(/\r/g, '').split('\n')
    .flatMap(line => /^\s*(?:[-•]\s*)?4\.[1-7](?:\s*[).:-]|\s+)/.test(line)
      ? line.replace(/[;,]\s*(?=4\.[1-7](?:\s*[).:-]|\s+))/g, '\n').split('\n') : [line])
  for (const line of lines) {
    const match = /^\s*(?:[-•]\s*)?4\.([1-7])(?:\s*[).:-]|\s+)\s*(.*)$/i.exec(line)
    if (!match) continue
    const marker = /(?:\||;)\s*(?:respuesta|rpta|rta)\s*:\s*(.*)$/i.exec(match[2])
    if (marker) {
      if (marker[1].trim()) rows.push({ id: Number(match[1]), value: marker[1].trim() })
      continue
    }
    const short = match[2].trim()
    const id = Number(match[1])
    if (id <= 4 && /^(?:s[ií]|sip|sipo|no|nop|negativo|afirmativo)[.!\s]*$/i.test(short)) {
      rows.push({ id, value: short })
    } else if (id === 5 && short.length >= 3 && !/[¿?]/.test(short) && !/\|\s*(?:respuesta|rpta)\s*:/i.test(short)) {
      rows.push({ id, value: short })
    } else if (id >= 6 && /^(?:\d{1,2})(?:\s*(?:pisos?|plantas?|niveles?))?[.!\s]*$/i.test(short)) {
      rows.push({ id, value: short })
    }
  }
  if (compactAccessForm(text)) {
    for (const match of text.matchAll(/(?:^|[\s,;])(?:4\.([1-4])|([1-4]))\s*(?:[).:]|\s+)\s*(s[ií]|sip|sipo|no|nop|afirmativo|negativo)(?=$|[\s,;.!])/gi)) {
      rows.push({ id: Number(match[1] || match[2]), value: match[3] })
    }
  }
  if (!rows.length && state?.intake) {
    const unanswered = unansweredAccess(state.intake.tommyAccess || {})
    if (unanswered.length === 1 && unanswered[0].kind === 'binary' && /^(?:s[ií]|sip|sipo|no|nop)[.!\s]*$/i.test(text.trim())) {
      rows.push({ id: unanswered[0].id, value: text.trim() })
    }
  }
  // El formato abreviado NUNCA completa el formulario original cuando no hay contexto.
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
  if (!state.intake || !isTommyAccessReply(text, state)) return state
  const next = structuredClone(state)
  const access: TommyAccess = { ...(next.intake?.tommyAccess || {}) }
  const answers = extractAccessAnswers(text, state)
  const byId = new Map<number, Set<string>>()
  for (const answer of answers) {
    if (!byId.has(answer.id)) byId.set(answer.id, new Set())
    byId.get(answer.id)!.add(normalize(answer.value))
  }
  // Dos respuestas diferentes para el mismo número = ambigüedad, no inventar.
  for (const [id, values] of byId) {
    if (values.size !== 1) continue
    const value = answers.find(a => a.id === id)!.value
    const q = QUESTIONS.find(q => q.id === id)!
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
