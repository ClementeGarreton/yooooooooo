/**
 * RECONOCER UN LISTADO PEGADO contra el catálogo de items del cotizador.
 *
 * El cliente pega lo que ya tiene escrito (una nota del celular, un WhatsApp: «2 camas de
 * 2 plazas, refri, 6 sillas, tele 55"») y esto devuelve, línea por línea, uno de tres
 * resultados:
 *  - `match`: un solo item del catálogo calza sin ambigüedad → se agrega directo.
 *  - `doubt`: calzan varios, o calza solo en parte → se le pregunta con los candidatos.
 *  - `none`: nada del catálogo se parece → se ofrece buscarlo o cargarlo a mano.
 *
 * Por qué así y no un «contiene»: el catálogo tiene familias enteras que comparten
 * palabras (siete camas, cuatro sillones, tres racks), y un «cama» que se agregue solo
 * como «Cama 1 Plaza» cotiza mal sin que nadie lo note. La regla es agregar solo cuando
 * la respuesta es única y PREGUNTAR todo lo demás; equivocarse preguntando cuesta un
 * click, equivocarse agregando cuesta plata.
 *
 * Acá no hay red ni React: entra el texto y el catálogo, sale la clasificación. Corre en
 * el navegador sobre el catálogo que ya cargó el paso de items.
 */

export interface MatchableItem {
  id: string
  name: string
}

export interface ParsedLine {
  /** El pedazo de texto tal como lo escribió el cliente. */
  raw: string
  /** Sin la cantidad, para mostrar y para buscar. */
  text: string
  quantity: number
}

export type LineMatch<T extends MatchableItem> =
  | { status: 'match'; line: ParsedLine; item: T }
  | { status: 'doubt'; line: ParsedLine; candidates: T[] }
  | { status: 'none'; line: ParsedLine }

const MAX_QUANTITY = 99
// Ocho y no cuatro: «cama» calza con diez camas y la que busca suele no ser la primera.
const MAX_CANDIDATES = 8

// ---------------------------------------------------------------------------
// Normalización
// ---------------------------------------------------------------------------

const NUMBER_WORDS: Record<string, number> = {
  un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7,
  ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, quince: 15, veinte: 20,
}

const STOPWORDS = new Set([
  'de', 'del', 'la', 'las', 'el', 'los', 'lo', 'con', 'para', 'por', 'y', 'e', 'a', 'al',
  'en', 'mi', 'mis', 'tipo', 'unidad', 'unidade', 'u', 'ud', 'uds', 'aprox', 'aproximadamente',
  'mas', 'o', 'pulgada', 'pulg', 'grs', 'cm', 'mt', 'mts', 'metro',
])

/** Frases que se reescriben antes de separar en palabras (ya sin tildes ni mayúsculas). */
const PHRASE_SYNONYMS: Array<[RegExp, string]> = [
  [/\bplaza y media\b/g, '1p5 plaza'],
  [/\bbox ?spring\b/g, 'boxspring'],
  [/\bking size\b/g, 'king'],
  [/\bsmart ?tv\b/g, 'tv'],
  [/\bmesita de noche\b/g, 'velador'],
  [/\bmueble (?:de |para |del )?(?:la )?(?:tv|tele|television|televisor)\b/g, 'rack'],
  [/\bfrigobar\b/g, 'frigo bar'],
  [/\bminibar\b/g, 'mini bar'],
  [/\bcinta de correr\b/g, 'trotadora'],
  [/\blava ?vajillas?\b/g, 'lavavajillas'],
  [/\baire acondicionado\b/g, 'aire acondicionado'],
  [/\bmatrimonial\b/g, '2 plaza'],
]

/** Palabra suelta → la palabra que usa el catálogo. Se aplica ya en singular. */
const WORD_SYNONYMS: Record<string, string> = {
  refri: 'refrigerador', refrigeradora: 'refrigerador', heladera: 'refrigerador',
  nevera: 'refrigerador', frigorifico: 'refrigerador',
  tele: 'tv', televisor: 'tv', television: 'tv', led: 'tv',
  sofa: 'sillon',
  lavarropa: 'lavadora',
  micro: 'microonda',
  armario: 'ropero', guardarropa: 'ropero', closet: 'closet',
  bici: 'bicicleta',
  librero: 'biblioteca', estanteria: 'estante',
  caminadora: 'trotadora',
  asador: 'parrilla',
  congelador: 'freezer',
  chico: 'pequeno', chica: 'pequeno', pequena: 'pequeno',
  mediana: 'mediano',
  velador: 'velador',
  comoda: 'comoda',
  colchoneta: 'colchon',
  maceta: 'planta', macetero: 'planta',
  valija: 'maleta',
}

const SIZE_WORDS = new Set(['grande', 'mediano', 'pequeno'])

/**
 * Palabras que por sí solas no dicen qué es. «Mueble / Buffet» se llama «Mueble», pero
 * «muebles» en un listado no es ese buffet: se pregunta aunque el nombre calce exacto.
 */
const GENERIC_WORDS = new Set(['mueble'])

function stripAccents(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

/** Plural a singular, lo justo para que «sillones» y «sillón» sean la misma palabra. */
function singular(word: string): string {
  if (word.length < 4 || /\d/.test(word)) return word
  if (word.endsWith('ces')) return `${word.slice(0, -3)}z`
  if (word.endsWith('es')) {
    const before = word.charAt(word.length - 3)
    const beforeThat = word.charAt(word.length - 4)
    // «colchones», «refrigeradores», «paneles» → quitar «es»; «muebles», «sobres»
    // (consonante antes de la l/r), «juguetes» y «grandes» → solo la «s».
    if ('rnl'.includes(before) && !('lr'.includes(before) && !'aeiou'.includes(beforeThat))) {
      return word.slice(0, -2)
    }
    return word.slice(0, -1)
  }
  if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1)
  return word
}

/**
 * Texto → palabras comparables: sin tildes, en singular, con sinónimos y números.
 * `isQuery`: solo lo que escribe el cliente pasa pulgadas de TV a tamaño; los nombres del
 * catálogo ya dicen «Grande» o «Mediano».
 */
function tokenize(value: string, isQuery = false): string[] {
  let text = stripAccents(value.toLowerCase())
  text = text.replace(/(\d)[.,](\d)/g, '$1p$2') // 1,5 y 1.5 → 1p5
  for (const [pattern, replacement] of PHRASE_SYNONYMS) text = text.replace(pattern, replacement)
  text = text.replace(/[^a-z0-9]+/g, ' ')

  const tokens: string[] = []
  for (const raw of text.split(' ')) {
    if (!raw) continue
    if (raw in NUMBER_WORDS) {
      tokens.push(String(NUMBER_WORDS[raw]))
      continue
    }
    const word = singular(raw)
    const mapped = WORD_SYNONYMS[word] ?? WORD_SYNONYMS[raw] ?? word
    for (const part of mapped.split(' ')) {
      if (part && !STOPWORDS.has(part)) tokens.push(part)
    }
  }

  // Televisores: el catálogo los separa por tamaño, no por pulgadas.
  if (isQuery && tokens.includes('tv')) {
    return tokens.map((t) => {
      const inches = /^\d+$/.test(t) ? Number(t) : NaN
      if (inches >= 19 && inches <= 100) return inches > 50 ? 'grande' : 'mediano'
      return t
    })
  }
  return tokens
}

const isNumberToken = (t: string) => /^\d+(p\d+)?$/.test(t)

// ---------------------------------------------------------------------------
// Separar el texto en líneas y leer la cantidad
// ---------------------------------------------------------------------------

const QTY_WORD = '(?:un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|quince|veinte|\\d{1,3})'

/** Parte el texto pegado en pedazos, uno por cosa. */
export function splitItemList(text: string): string[] {
  // «,» separa salvo entre dígitos («1,5 plazas»). Se protege con un marcador en vez de
  // un lookbehind, que Safari recién soporta desde la 16.4 y rompería el paso entero.
  const DECIMAL = '\u0000'
  return text
    .normalize('NFC')
    .replace(/(\d),(\d)/g, `$1${DECIMAL}$2`)
    .split(/\r?\n/)
    .flatMap((line) =>
      line
        // «;», «|», viñetas y « + » separan siempre.
        .split(/[;|•·,]|\s\+\s/)
        // «una cama y dos veladores»: la «y» separa solo si después viene una cantidad,
        // para no romper «Vitrina de Vidrio y Madera».
        .flatMap((part) => part.split(new RegExp(`\\s(?:y|e)\\s(?=${QTY_WORD}\\s)`, 'i')))
    )
    .map((part) => part.split(DECIMAL).join(',').trim())
    .filter(Boolean)
}

/** Lee la cantidad de un pedazo. Sin cantidad escrita, es 1. */
export function parseLine(raw: string): ParsedLine | null {
  let text = raw
    .normalize('NFC')
    .trim()
    .replace(/^[-*–—>●○▪✓✔]+\s*/, '') // viñetas
    .replace(/^\d{1,2}[.)]\s+/, '') // numeración «1. » o «2) »: no es cantidad
    .trim()

  // «Dormitorio:» o «Cocina:» son títulos del listado, no cosas.
  if (!text || /:\s*$/.test(text)) return null

  let quantity: number | null = null
  const lower = stripAccents(text.toLowerCase())

  const leadingPair = /^(un par de|par de)\s+/.exec(lower)
  const leadingDozen = /^(media docena de|una docena de|docena de)\s+/.exec(lower)
  const leadingNumber = /^(\d{1,3})\s*(?:x\s*|unidades?\s+(?:de\s+)?|uds?\.?\s+)?(?=[a-z])/i.exec(lower)
  const leadingWord = new RegExp(`^(${QTY_WORD})\\s+`, 'i').exec(lower)
  const trailing = /\s*(?:x\s*(\d{1,3})|\((\d{1,3})\)|[:=]\s*(\d{1,3})|\s-\s*(\d{1,3})|(\d{1,3})\s*(?:u|uds?|unidades?)\.?)\s*$/i.exec(lower)

  if (leadingPair) {
    quantity = 2
    text = text.slice(leadingPair[0].length)
  } else if (leadingDozen) {
    quantity = leadingDozen[1].startsWith('media') ? 6 : 12
    text = text.slice(leadingDozen[0].length)
  } else if (leadingNumber) {
    quantity = Number(leadingNumber[1])
    text = text.slice(leadingNumber[0].length)
  } else if (leadingWord && leadingWord[1] in NUMBER_WORDS) {
    quantity = NUMBER_WORDS[leadingWord[1]]
    text = text.slice(leadingWord[0].length)
  } else if (/^x\s*(\d{1,3})\s+/i.test(lower)) {
    const m = /^x\s*(\d{1,3})\s+/i.exec(lower)!
    quantity = Number(m[1])
    text = text.slice(m[0].length)
  }

  if (trailing) {
    const n = Number(trailing.slice(1).find(Boolean))
    // Si ya había cantidad adelante, la de atrás manda solo si la de adelante era 1
    // («una silla x6» es raro, «silla x6» es lo normal).
    if (quantity === null || quantity === 1) quantity = n
    text = text.slice(0, text.length - trailing[0].length)
  }

  text = text.trim()
  if (!text || !/[a-záéíóúñ]/i.test(text)) return null

  const qty = Math.min(MAX_QUANTITY, Math.max(1, Math.trunc(quantity ?? 1)))
  return { raw: raw.trim(), text, quantity: qty }
}

// ---------------------------------------------------------------------------
// Índice del catálogo y puntaje
// ---------------------------------------------------------------------------

interface Alias {
  /** Palabras del nombre, fuera de paréntesis: las que definen al item. */
  primary: string[]
  /** Todo lo que puede calzar, incluido lo que va entre paréntesis. */
  all: Set<string>
  numbers: Set<string>
  sizes: Set<string>
}

interface IndexedItem<T> {
  item: T
  aliases: Alias[]
}

export interface CatalogIndex<T extends MatchableItem> {
  items: IndexedItem<T>[]
  vocabulary: Set<string>
}

function buildAlias(name: string): Alias {
  const outside = name.replace(/\([^)]*\)/g, ' ')
  const inside = (name.match(/\(([^)]*)\)/g) || []).join(' ')
  const primary = Array.from(new Set(tokenize(outside)))
  const all = new Set([...primary, ...tokenize(inside)])
  return {
    primary,
    all,
    numbers: new Set(Array.from(all).filter(isNumberToken)),
    sizes: new Set(Array.from(all).filter((t) => SIZE_WORDS.has(t))),
  }
}

export function buildCatalogIndex<T extends MatchableItem>(catalog: T[]): CatalogIndex<T> {
  const vocabulary = new Set<string>()
  const items = catalog.map((item) => {
    // «Velador/Mesa de Noche» son dos nombres para lo mismo: cada uno puntúa por su cuenta.
    const aliases = item.name
      .split('/')
      .map((n) => n.trim())
      .filter(Boolean)
      .map(buildAlias)
    for (const alias of aliases) alias.all.forEach((t) => vocabulary.add(t))
    return { item, aliases }
  })
  return { items, vocabulary }
}

function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    let best = i
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      best = Math.min(best, row[j])
    }
    if (best > max) return max + 1
    prev = row
  }
  return prev[b.length]
}

/**
 * Palabras del cliente que el catálogo conoce. Una con un error de tipeo («refrijerador»)
 * se corrige a la palabra del catálogo más cercana, solo si hay UNA a esa distancia. Las
 * que no se parecen a nada («samsung», «blanco») se descartan: no ayudan a elegir.
 */
function knownTokens(tokens: string[], vocabulary: Set<string>): string[] {
  const result: string[] = []
  for (const token of tokens) {
    if (vocabulary.has(token)) {
      result.push(token)
      continue
    }
    if (isNumberToken(token) || token.length < 5) continue
    const max = token.length >= 8 ? 2 : 1
    const close = Array.from(vocabulary).filter(
      (v) => !isNumberToken(v) && editDistance(token, v, max) <= max
    )
    if (close.length === 1) result.push(close[0])
  }
  return Array.from(new Set(result))
}

interface Scored<T> {
  item: T
  score: number
  /** Todas las palabras del cliente calzaron y ningún número ni tamaño contradice. */
  full: boolean
  /** Además, el nombre del item no tiene palabras de más: es exactamente lo que escribió. */
  exact: boolean
}

function scoreItem<T>(query: string[], entry: IndexedItem<T>): Scored<T> {
  let best: Scored<T> = { item: entry.item, score: 0, full: false, exact: false }
  const queryNumbers = query.filter(isNumberToken)
  const querySizes = query.filter((t) => SIZE_WORDS.has(t))

  for (const alias of entry.aliases) {
    const matched = query.filter((t) => alias.all.has(t))
    const qcov = matched.length / query.length
    const pcov = alias.primary.length
      ? alias.primary.filter((t) => query.includes(t)).length / alias.primary.length
      : 0
    let score = 0.7 * qcov + 0.3 * pcov

    // «cama 2 plazas» no puede ser «Cama 1 Plaza», ni «refrigerador grande» el pequeño.
    const numberConflict =
      queryNumbers.length > 0 && alias.numbers.size > 0 && !queryNumbers.some((n) => alias.numbers.has(n))
    const sizeConflict =
      querySizes.length > 0 && alias.sizes.size > 0 && !querySizes.some((s) => alias.sizes.has(s))
    if (numberConflict) score *= 0.4
    if (sizeConflict) score *= 0.5

    const full = qcov === 1 && !numberConflict && !sizeConflict
    const candidate = { item: entry.item, score, full, exact: full && pcov === 1 }
    if (
      candidate.score > best.score ||
      (candidate.score === best.score && candidate.exact && !best.exact)
    ) {
      best = candidate
    }
  }
  return best
}

/** Una línea contra todo el catálogo. */
export function matchLine<T extends MatchableItem>(line: ParsedLine, index: CatalogIndex<T>): LineMatch<T> {
  const query = knownTokens(tokenize(line.text, true), index.vocabulary)
  if (query.length === 0) return { status: 'none', line }

  const scored = index.items
    .map((entry) => scoreItem(query, entry))
    .filter((s) => s.score >= 0.3)
    .sort((a, b) => b.score - a.score || Number(b.exact) - Number(a.exact))

  if (scored.length === 0) return { status: 'none', line }

  const full = scored.filter((s) => s.full)
  const onlyGeneric = query.every((t) => GENERIC_WORDS.has(t))
  if (onlyGeneric) {
    return { status: 'doubt', line, candidates: scored.slice(0, MAX_CANDIDATES).map((s) => s.item) }
  }
  if (full.length === 1) return { status: 'match', line, item: full[0].item }
  const exact = full.filter((s) => s.exact)
  if (exact.length === 1) return { status: 'match', line, item: exact[0].item }

  // Con duda: primero los que calzan entero, después los parciales.
  const ordered = full.length > 0 ? [...full, ...scored.filter((s) => !s.full)] : scored
  return {
    status: 'doubt',
    line,
    candidates: ordered.slice(0, MAX_CANDIDATES).map((s) => s.item),
  }
}

/** El listado completo, en el orden en que lo pegó el cliente. */
export function matchItemList<T extends MatchableItem>(text: string, index: CatalogIndex<T>): LineMatch<T>[] {
  return splitItemList(text)
    .map(parseLine)
    .filter((line): line is ParsedLine => line !== null)
    .map((line) => matchLine(line, index))
}
