/**
 * Correspondencias aproximadas para el inventario de WhatsApp.
 * La estimación nunca crea IDs ajenos al catálogo y evita preguntar al
 * cliente por variaciones comerciales sin relevancia operativa evidente.
 */
export interface InventoryCandidate {
  catalogItemId: string
  label: string
  confidence?: number
}

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/\b(sillones|sillon|sofas|sofa)\b/g, 'sofa')
    .replace(/\b(televisor|television|tv)\b/g, 'tv')
    .replace(/\b(cama|camas|colchon|colchones)\s+(?:de\s+)?(?:matrimonial(?:es)?|matrimonio|doble(?:s)?)\b/g, (_, noun: string) => `${noun.startsWith('colch') ? 'colchon' : 'cama'} 2 plazas`)
    .replace(/\b(cama|camas|colchon|colchones)\s+(?:de\s+)?individual(?:es)?\b/g, (_, noun: string) => `${noun.startsWith('colch') ? 'colchon' : 'cama'} 1 plaza`)
    .replace(/\b(mueble para|mueble de)\b/g, 'mueble ')
    .replace(/\b(armario|closet|ropero|guardarropa)\b/g, 'ropero')
    .replace(/\b(comoda|cajonera|gavetero)\b/g, 'cajonera')
    .replace(/\b(camas|colchones)\b/g, (noun: string) => noun === 'camas' ? 'cama' : 'colchon')
    .replace(/\bplaza\b/g, 'plazas')
}

function significantWords(value: string): string[] {
  const ignored = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'un', 'una', 'para', 'y', 'en', 'con', 'mueble', 'tipo', 'aprox', 'aproximado'])
  return normalize(value).split(/[^a-z0-9]+/).filter((token) => (token.length > 1 || /^\d+$/.test(token)) && !ignored.has(token))
}

export function chooseClosestInventoryCandidate(sourceLabel: string, candidates: InventoryCandidate[]): InventoryCandidate | null {
  if (!candidates.length) return null
  const sourceWords = significantWords(sourceLabel)
  const sourceDigits = sourceWords.filter((word) => /^\d+$/.test(word))
  const scored = candidates.map((candidate, index) => {
    const words = significantWords(candidate.label)
    // No convertir un ropero en una alfombra por ser la única sugerencia.
    const sharedWords = sourceWords.filter((word) => words.includes(word))
    const candidateDigits = words.filter((word) => /^\d+$/.test(word))
    // No aproximar tamaños expresos incompatibles (2 plazas != 1 plaza).
    const incompatibleSize = sourceDigits.length > 0 && candidateDigits.length > 0
      && !sourceDigits.every((digit) => candidateDigits.includes(digit))
    const semanticallyRelated = sharedWords.some((word) => !/^\d+$/.test(word))
    let score = (candidate.confidence || 0) * 2
    for (const word of sourceWords) {
      if (words.includes(word)) score += /^\d+$/.test(word) ? 12 : 2
    }
    if (incompatibleSize) score -= 10
    // Sin tamaño especificado, se estima con el modelo mediano en vez de pedir un catálogo entero.
    if (!sourceDigits.length && /\b(mediano|mediana|medio|media)\b/i.test(normalize(candidate.label))) score += 3
    if (!sourceDigits.length && /\b(grande|gigante|extra grande)\b/i.test(normalize(candidate.label))) score -= 1
    return { candidate, index, score, semanticallyRelated, incompatibleSize }
  })
  const related = scored.filter((item) => item.semanticallyRelated && !item.incompatibleSize)
  if (!related.length) return null
  related.sort((a, b) => b.score - a.score || a.index - b.index)
  return related[0].candidate
}

/** Detecta adiciones tardías al inventario sin confundirlas con extras. */
export function isInventoryAddition(text: string): boolean {
  const normalized = normalize(text.trim())
  if (/\b(embalaje|embalar|desembalaje|desembalar|desarme|desarmar|armado|armar|ninguno|ninguna)\b/.test(normalized)) return false
  return /\b(agrega|agregar|anade|anadir|suma|sumar|olvide|falta|falto|tambien llevo|ademas llevo|otro mueble|otra caja|incluye)\b/.test(normalized)
}

/** Evidencia de cada foto que quedó efectivamente guardada en la cotización. */
export type InventoryPhotoRecord = {
  messageId: string
  status: 'processing' | 'done' | 'needs_description'
  recognized: string[]
  storagePath?: string
}

export function upsertInventoryPhoto<T extends { inventoryPhotos?: InventoryPhotoRecord[]; inventoryCollectionDone?: boolean }>(
  state: T, photo: InventoryPhotoRecord,
): T {
  const photos = [...(state.inventoryPhotos || [])]
  const index = photos.findIndex((saved) => saved.messageId === photo.messageId)
  if (index === -1) photos.push(photo)
  else photos[index] = photo
  return { ...state, inventoryPhotos: photos, inventoryCollectionDone: false }
}

export function canCloseInventory(state: {
  items: Array<{ catalogItemId: string; quantity: number }>
  pendingInventory: unknown[]
  inventoryPhotos?: InventoryPhotoRecord[]
}): boolean {
  return state.items.length > 0 && state.pendingInventory.length === 0
    && (state.inventoryPhotos || []).every((photo) => photo.status === 'done')
}
