/**
 * Edición determinista y transaccional del inventario confirmado en WhatsApp.
 * Ninguna operación se aplica si otra operación del mismo mensaje falla.
 * No requiere cambios de esquema ni servicios adicionales.
 */
export interface CatalogInventoryItem { id: string; name: string; is_active?: boolean }
export interface InventorySelection { catalogItemId: string; quantity: number }
export interface InventoryEdit { action: 'remove' | 'add'; description: string; quantity: number | null }

const ACTION = /^(quitar|eliminar|sacar|agregar|añadir|anadir|sumar|incluir)\s+(.+)$/i
const CONNECTOR = /\s+(?:y|,|;)\s+(?=(?:quitar|eliminar|sacar|agregar|añadir|anadir|sumar|incluir)\b)|\s*[,;]\s*(?=(?:quitar|eliminar|sacar|agregar|añadir|anadir|sumar|incluir)\b)/i

function normalize(value: string): string {
  return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(sofas|sillones|sillon|sofa)\b/g, 'sofa')
    .replace(/\b(nevera|heladera|refri|refrigeradora)\b/g, 'refrigerador')
    // Equivalencias comerciales chilenas: no confundir una cama matrimonial con una King/Queen.
    .replace(/\b(cama|camas|colchon|colchones)\s+(?:de\s+)?(?:matrimonial(?:es)?|matrimonio|doble(?:s)?)\b/g, (_, noun: string) => `${noun.startsWith('colch') ? 'colchon' : 'cama'} 2 plazas`)
    .replace(/\b(cama|camas|colchon|colchones)\s+(?:de\s+)?individual(?:es)?\b/g, (_, noun: string) => `${noun.startsWith('colch') ? 'colchon' : 'cama'} 1 plaza`)
    .replace(/\b(armario|closet|guardarropa)\b/g, 'ropero')
    .replace(/\b(comoda|gavetero)\b/g, 'cajonera')
    .replace(/\b(dos)\b/g, '2').replace(/\b(tres)\b/g, '3')
    .replace(/\b(cuatro)\b/g, '4').replace(/\b(uno|una)\b/g, '1')
    .replace(/\b(camas|colchones)\b/g, (noun: string) => noun === 'camas' ? 'cama' : 'colchon')
    .replace(/\bplaza\b/g, 'plazas')
    .replace(/[^a-z0-9]+/g, ' ').trim()
}

function meaningful(value: string): string[] {
  return normalize(value).split(' ').filter((word) => word && !['el','la','los','las','de','del','un','una','unos','unas','para','tipo','mueble','x'].includes(word))
}

/** Comandos explícitos, sin inferir altas o bajas de mensajes normales. */
export function parseInventoryEdits(text: string): InventoryEdit[] | null {
  let value = text.trim().replace(/^(?:(?:quiero|quisiera|necesito|por\s+favor)\s+)+/i, '')
  if (!ACTION.test(value)) return null
  const parts = value.split(CONNECTOR)
  const edits: InventoryEdit[] = []
  for (const part of parts) {
    const found = part.trim().match(ACTION)
    if (!found) return []
    const action = /^(quitar|eliminar|sacar)$/i.test(found[1]) ? 'remove' : 'add'
    let description = found[2].trim().replace(/[.!]+$/, '')
    let quantity: number | null = null
    const prefix = description.match(/^(\d+|un|una|uno|otra|otro|dos|tres|cuatro|cinco)\s+(?:x\s+)?/i)
    if (prefix) {
      const numbers: Record<string, number> = { un: 1, una: 1, uno: 1, otra: 1, otro: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5 }
      quantity = numbers[prefix[1].toLowerCase()] || Number(prefix[1])
      description = description.slice(prefix[0].length).trim()
    }
    if (!description || (quantity !== null && (!Number.isInteger(quantity) || quantity < 1 || quantity > 100))) return []
    edits.push({ action, description, quantity })
  }
  return edits
}

export type ApplyEditsResult =
  | { ok: true; items: InventorySelection[]; descriptions: string[] }
  | { ok: false; error: string }

function findUniqueMatch(query: string, catalog: CatalogInventoryItem[]): CatalogInventoryItem | null | 'ambiguous' {
  const words = meaningful(query)
  if (!words.length) return null
  const exact = catalog.filter((item) => meaningful(item.name).join(' ') === words.join(' '))
  if (exact.length === 1) return exact[0]
  if (exact.length > 1) return 'ambiguous'
  // Se admiten descripciones parciales SOLO cuando identifican un único artículo.
  // Los números de tamaño son obligatorios: un sofá de 2 cuerpos jamás puede
  // convertirse en uno de 3 cuerpos.
  const candidates = catalog.filter((item) => {
    const itemWords = meaningful(item.name)
    return words.every((word) => itemWords.includes(word))
  })
  return candidates.length === 1 ? candidates[0] : candidates.length > 1 ? 'ambiguous' : null
}

/** Pure: resuelve y aplica TODAS las operaciones sobre una copia en memoria. */
export function applyInventoryEdits(
  current: InventorySelection[],
  edits: InventoryEdit[],
  catalog: CatalogInventoryItem[],
): ApplyEditsResult {
  if (!edits.length) return { ok: false, error: 'No pude interpretar la corrección. Prueba: QUITAR refrigerador Y AGREGAR un sofá de 2 cuerpos.' }
  const items = current.map((item) => ({ ...item }))
  const confirmations: string[] = []
  for (const edit of edits) {
    const possible = edit.action === 'remove'
      ? catalog.filter((item) => items.some((entry) => entry.catalogItemId === item.id))
      : catalog.filter((item) => item.is_active !== false)
    const matched = findUniqueMatch(edit.description, possible)
    if (!matched || matched === 'ambiguous') {
      return { ok: false, error: matched === 'ambiguous'
        ? `«${edit.description}» coincide con varios muebles. Indica el nombre completo que aparece en el inventario. No cambié nada.`
        : `No encontré «${edit.description}» ${edit.action === 'remove' ? 'en tu inventario' : 'en el catálogo'}. No cambié nada.` }
    }
    const existing = items.find((item) => item.catalogItemId === matched.id)
    if (edit.action === 'remove') {
      if (!existing) return { ok: false, error: `«${matched.name}» no está en el inventario. No cambié nada.` }
      if (edit.quantity !== null && existing.quantity < edit.quantity) {
        return { ok: false, error: `Solo hay ${existing.quantity} × ${matched.name}. No cambié nada.` }
      }
      const count = edit.quantity ?? existing.quantity
      existing.quantity -= count
      if (existing.quantity === 0) items.splice(items.indexOf(existing), 1)
      confirmations.push(`− ${count} × ${matched.name}`)
    } else {
      const count = edit.quantity ?? 1
      if (existing) existing.quantity += count
      else items.push({ catalogItemId: matched.id, quantity: count })
      confirmations.push(`+ ${count} × ${matched.name}`)
    }
  }
  if (items.length === 0) return { ok: false, error: 'El inventario quedaría vacío. Agrega al menos un mueble antes de confirmar. No cambié nada.' }
  return { ok: true, items, descriptions: confirmations }
}
