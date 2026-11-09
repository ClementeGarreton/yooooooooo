/**
 * Elicitación diferencial: el mensaje emitido por el bot es la referencia.
 * Extraer lo introducido por el cliente antes de interpretarlo. Sin extrapolar
 * desde el texto de las preguntas originales ni asumir que un campo fue respondido.
 *
 * Implementación pura: no necesita servidor, IA, base de datos ni credenciales.
 */
export type DiffField = 'direcciones' | 'articulos' | 'fecha' | 'escaleras' | 'acarreo' | 'embalaje'
export const DIFF_FIELDS: DiffField[] = ['direcciones', 'articulos', 'fecha', 'escaleras', 'acarreo', 'embalaje']
export type DiffAnswer = { field: DiffField; value: string; method: 'insertion' | 'replacement' | 'direct' }
export type DiffResult = {
  copiedForm: boolean
  answers: DiffAnswer[]
  undecided: DiffField[]
  conflicted: DiffField[]
  freeText: string
}

type Segment = { field: DiffField; body: string; originalLine: string }
type Token = { word: string; start: number; end: number }

const clean = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
const simple = (s: string) => clean(s).replace(/[^a-z0-9ñ]+/g, ' ').trim()
const WORDS = /[\p{L}\p{N}]+/gu
function tokens(s: string): Token[] {
  const found: Token[] = []
  for (const m of s.matchAll(WORDS)) found.push({ word: clean(m[0]), start: m.index, end: m.index + m[0].length })
  return found
}

const labelField = (text: string): DiffField | null => {
  const t = simple(text)
  if (/^direc|^origen y destino/.test(t)) return 'direcciones'
  if (/^lista de art|^inventario|^articulos? a trasladar/.test(t)) return 'articulos'
  if (/^fecha/.test(t)) return 'fecha'
  if (/^escale|^escalera/.test(t)) return 'escaleras'
  if (/^distancia de carga|^acarreo/.test(t)) return 'acarreo'
  if (/^embalaje|^embalar/.test(t)) return 'embalaje'
  return null
}

/** Se prioriza el número 1..6, para reconocer también errores ortográficos en el título. */
function segmentLine(line: string): Segment | null {
  const m = /^\s*(?:[-•*]\s*)?(?:([1-6])\s*[).:\-]\s*)?([^:\n]{2,105}?)([:.]\s*|$)(.*)$/.exec(line)
  if (!m) return null
  const field = m[1] ? DIFF_FIELDS[Number(m[1]) - 1] : labelField(m[2])
  if (!field) return null
  if (!m[1] && !labelField(m[2])) return null
  // No interpretar encabezados sin número ni etiqueta legítima.
  if (m[2].trim().split(/\s+/).length > 15) return null
  return { field, body: m[4].trim(), originalLine: line }
}

function segmentMessage(message: string): { segments: Segment[]; loose: string[] } {
  const segments: Segment[] = []; const loose: string[] = []
  // WhatsApp puede juntar todo el formulario en una sola línea al pegarlo.
  const unfolded = message.replace(/\r/g, '').replace(/\s+([1-6])\s*\)\s*(?=(?:direc|lista|fecha|escal|distancia|acarreo|embalaje))/gi, '\n$1) ')
  for (const line of unfolded.split('\n')) {
    // 4.1–4.7 son preguntas independientes. Nunca interpretarlas como «4) Escaleras».
    if (/^\s*(?:[-•*]\s*)?4\.[1-7]\s*[).:-]/.test(line)) continue
    const seg = segmentLine(line)
    if (seg) segments.push(seg)
    else if (line.trim()) loose.push(line.trim())
  }
  return { segments, loose }
}

/**
 * Respuesta delimitada explícitamente por el cliente al copiar la pregunta.
 * El rótulo existe también en el formulario ORIGINAL: nunca es una respuesta.
 * Acepta | Respuesta:, ; Respuesta: y una línea Respuesta: bajo la pregunta.
 * No depende de la semejanza de embeddings, puntuación libre ni vocabularios
 * particulares de muebles: asigna la respuesta según el número/etiqueta.
 */
function markedAnswer(body: string): string | null {
  const match = /(?:^|[|;]|\n)\s*(?:respuesta|rpta|rta)\s*:\s*(.*)$/i.exec(body)
  return match ? match[1].trim() : null
}

/** distancia de Levenshtein limitada a pequeñas erratas en una palabra del guion. */
function typo(a: string, b: string): boolean {
  if (a === b || a.length < 5 || b.length < 5 || Math.abs(a.length - b.length) > 2) return false
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]; dp[0] = i
    for (let j = 1; j <= b.length; j++) {
      const old = dp[j]
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = old
    }
  }
  return dp[b.length] <= 2
}

/** LCS de palabras: conserva el texto común aunque haya inserciones intercaladas. */
function commonAlignment(reference: Token[], submitted: Token[]): { matched: number[]; unmatched: number[]; score: number } {
  const n = reference.length; const m = submitted.length
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1))
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
    dp[i][j] = reference[i].word === submitted[j].word ? 1 + dp[i + 1][j + 1] : Math.max(dp[i + 1][j], dp[i][j + 1])
  }
  const matched: number[] = []; const unmatched: number[] = []
  let i = 0; let j = 0
  while (j < m) {
    if (i < n && reference[i].word === submitted[j].word) { matched.push(j); i++; j++ }
    else if (i < n && dp[i + 1][j] >= dp[i][j + 1] && dp[i + 1][j] > dp[i][j + 1]) i++
    else { unmatched.push(j); j++ }
  }
  return { matched, unmatched, score: matched.length }
}

function extractInsertions(reference: string, submitted: string): { text: string; overlap: number } {
  const a = tokens(reference); const b = tokens(submitted)
  const alignment = commonAlignment(a, b)
  // Si el cliente reemplazó TODA la pregunta por una respuesta corta, usarla.
  if (b.length > 0 && b.length <= 16 &&
      (alignment.score <= 1 || alignment.score / Math.max(1, b.length) <= 0.35) &&
      !/^(indica|indicanos|hay que|necesitas|que articulos|articulos pisos|calle numero)/.test(simple(submitted))) {
    return { text: submitted.trim(), overlap: alignment.score }
  }
  if (!alignment.unmatched.length) {
    // Una respuesta puede ser puramente *sustitutiva*: el cliente elimina la
    // alternativa de la plantilla y deja solo (NO) en lugar de (SÍ / NO).
    const refWords = a.map(t => t.word).join(' ')
    const submittedWords = b.map(t => t.word).join(' ')
    const selected = b.at(-1)?.word || ''
    const optionWasChosen = / si no$/.test(refWords) &&
      /^(si|no)$/.test(selected) && b.length < a.length &&
      (submittedWords.endsWith(` ${selected}`) || submittedWords === selected)
    const promptWasReplaced = / responde no$/.test(refWords) &&
      selected === 'no' && a.length - b.length >= 2 &&
      submittedWords.endsWith(' no') && !submittedWords.endsWith(' responde no')
    if (optionWasChosen || promptWasReplaced) {
      return { text: submitted.slice(b[b.length - 1].start, b[b.length - 1].end), overlap: alignment.score }
    }
    // "No" y "Sí" también son palabras del guion: texto corto reemplazado
    // puede coincidir plenamente con él. Aceptarlo solo si no parece pregunta.
    if (b.length <= 3 && /^(si|no|ninguno|no hay|no aplica|sin embalaje|sin acarreo)$/.test(simple(submitted))) {
      return { text: submitted.trim(), overlap: alignment.score }
    }
    return { text: '', overlap: alignment.score }
  }
  const kept: number[] = []
  for (const index of alignment.unmatched) {
    // La palabra puede ser una errata del propio enunciado. Si no es una adición
    // semántica distinta, no introducirla como respuesta.
    const t = b[index]
    const vicinity = a.filter(r => Math.abs(r.start / Math.max(1, reference.length) - t.start / Math.max(1, submitted.length)) < 0.20)
    if (vicinity.some(r => typo(t.word, r.word))) continue
    kept.push(index)
  }
  if (!kept.length) return { text: '', overlap: alignment.score }
  // Reconstruir grupos de palabras contiguos: conserva los números y la grafía
  // real del cliente, sin añadir frases prestadas del formulario.
  const groups: string[] = []; let run: number[] = []
  const flush = () => {
    if (run.length) groups.push(submitted.slice(b[run[0]].start, b[run[run.length - 1]].end).trim())
    run = []
  }
  for (const x of kept) {
    if (run.length && x > run[run.length - 1] + 1) flush()
    run.push(x)
  }
  flush()
  return { text: groups.join(' ').trim(), overlap: alignment.score }
}

function harmlessCopiedLine(line: string): boolean {
  const t = simple(line)
  return /^(hola para cotizar|hola bienvenid|gracias por la informacion|para enviarte el presupuesto|copia este mensaje|apenas nos respondas|gracias con esto|si todo es no|si solo rechazas los servicios|si algun servicio es si|puedes responder todo junto|responde con un numero)/.test(t)
}

const answerLike = (s: string) => {
  const t = simple(s)
  return t.length > 0 && !/^(indica|indicanos|necesitas que|hay que caminar|que articulos debemos|articulos pisos y|calle numero comuna|lista de articulos)/.test(t)
}

/**
 * Resuelve cada campo contra la mejor referencia conocida (inicio o pendientes).
 * Si la modificación es insuficiente, NO la transforma en Sí o No.
 */
export function extractTommyDifferential(message: string, references: string[]): DiffResult {
  const parsed = segmentMessage(message)
  const reference = new Map<DiffField, string[]>()
  for (const text of references) for (const part of segmentMessage(text).segments) {
    reference.set(part.field, [...(reference.get(part.field) || []), part.body])
  }
  const response = new Map<DiffField, DiffAnswer>()
  const undecided = new Set<DiffField>()
  const conflicted = new Set<DiffField>()
  let copiedForm = false
  for (const part of parsed.segments) {
    const refs = reference.get(part.field) || []
    if (refs.length) copiedForm = true
    // Una copia idéntica gana siempre sobre referencias alternativas parecidas.
    // Evita leer el 'Sí / No' del propio recordatorio como respuesta.
    if (refs.some(ref => simple(ref) === simple(part.body))) {
      undecided.add(part.field)
      continue
    }
    // El ancla explícita tiene prioridad sobre un diff por similitud textual.
    // Si está vacía, NO atribuir «Sí/No» que aparezca en la pregunta.
    const explicit = markedAnswer(part.body)
    if (explicit !== null && explicit.length) {
      if (conflicted.has(part.field)) continue
      const prior = response.get(part.field)
      if (prior && simple(prior.value) !== simple(explicit)) {
        response.delete(part.field)
        undecided.add(part.field)
        conflicted.add(part.field)
        continue
      }
      response.set(part.field, { field: part.field, value: explicit, method: 'direct' })
      undecided.delete(part.field)
      continue
    }
    let proposed: { text: string; overlap: number } | null = null
    for (const ref of refs) {
      // El cliente puede contestar usando un formulario antiguo sin «Respuesta:».
      // No dejar que el nuevo marcador cambie cómo comparamos ese formato.
      const comparableReference = explicit === null
        ? ref.replace(/\s*\|\s*respuesta\s*:\s*$/i, '')
        : ref
      const item = extractInsertions(comparableReference, part.body)
      if (!proposed || item.overlap > proposed.overlap) proposed = item
    }
    // Sin referencia para comparar: solo aceptar un valor claramente independiente,
    // jamás asumir que el texto está respondido porque el rótulo está presente.
    const answer = refs.length ? proposed?.text || '' : (answerLike(part.body) ? part.body : '')
    if (!answerLike(answer) || conflicted.has(part.field)) { undecided.add(part.field); continue }
    const method = refs.length ? (proposed?.overlap === 0 ? 'replacement' : 'insertion') : 'direct'
    if (response.has(part.field) && simple(response.get(part.field)!.value) !== simple(answer)) {
      response.delete(part.field)
      undecided.add(part.field)
      conflicted.add(part.field)
      continue
    }
    if (!undecided.has(part.field)) response.set(part.field, { field: part.field, value: answer, method })
  }
  return {
    copiedForm,
    answers: [...response.values()],
    undecided: [...undecided].filter(field => !response.has(field)),
    conflicted: [...conflicted],
    freeText: parsed.loose.filter(line => !harmlessCopiedLine(line)).join('\n').trim(),
  }
}
