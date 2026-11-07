import { isPackagingTypeId, packagingLabel } from '@/lib/packagingCatalog'

/**
 * Aplica los precios de embalaje enviados desde el panel sobre los ítems ya
 * guardados de la cotización.
 *
 * El precio por ítem (`packaging.pricePerUnit`, CLP por m³) queda congelado al
 * cotizar y hasta ahora no había forma de corregirlo: había que rehacer la
 * cotización entera. Lo único que se toma del cliente es el embalaje; `name`,
 * `quantity`, `volume` y cualquier otro campo se copian del registro guardado,
 * así una corrección de precio no puede alterar el resto de la receta.
 *
 * Devuelve `{ error }` en vez de lanzar para poder responder 400 con el motivo.
 */
export function applyItemPackagingPrices(
  stored: unknown,
  incoming: unknown
): { items?: any[]; error?: string } {
  if (!Array.isArray(stored)) {
    return { error: 'La cotización no tiene una lista de ítems que actualizar' }
  }
  if (!Array.isArray(incoming)) {
    return { error: 'items_summary debe ser una lista' }
  }
  if (incoming.length !== stored.length) {
    return {
      error:
        'La lista de ítems cambió desde que abriste la cotización. Recárgala antes de guardar.',
    }
  }

  const items: any[] = []

  for (let i = 0; i < stored.length; i++) {
    const base = stored[i]
    const patch = incoming[i]

    if (!base || typeof base !== 'object' || !patch || typeof patch !== 'object') {
      return { error: `Ítem inválido en la posición ${i + 1}` }
    }

    // Chequeo de alineación: si el nombre no coincide, la lista se movió y aplicar
    // el precio acá se lo pondría al artículo equivocado.
    const baseName = String((base as any).name ?? '')
    const patchName = String((patch as any).name ?? '')
    if (patchName && patchName !== baseName) {
      return {
        error: `El ítem "${patchName}" no coincide con el guardado ("${baseName}"). Recarga la cotización.`,
      }
    }

    const nextItem: Record<string, unknown> = { ...(base as Record<string, unknown>) }
    const packaging = (patch as any).packaging

    if (!packaging || packaging.type === 'none' || packaging.type === null) {
      delete nextItem.packaging
      items.push(nextItem)
      continue
    }

    if (typeof packaging !== 'object') {
      return { error: `Embalaje inválido en "${baseName}"` }
    }

    const type = packaging.type
    if (!isPackagingTypeId(type)) {
      return { error: `Tipo de embalaje desconocido en "${baseName}"` }
    }

    const rawPrice = packaging.pricePerUnit
    if (rawPrice === '' || rawPrice === null || rawPrice === undefined) {
      return { error: `Falta el precio de embalaje de "${baseName}"` }
    }
    const price = Math.round(Number(rawPrice))
    if (!Number.isFinite(price) || price < 0) {
      return { error: `Precio de embalaje inválido en "${baseName}"` }
    }

    nextItem.packaging = { type, pricePerUnit: price }
    items.push(nextItem)
  }

  return { items }
}

/** Resumen legible del cambio de precios, para el log de actividad. */
export function describePriceChanges(before: any[], after: any[]): string[] {
  const changes: string[] = []
  for (let i = 0; i < after.length; i++) {
    const prev = before?.[i]?.packaging
    const next = after[i]?.packaging
    const prevPrice = prev?.type && prev.type !== 'none' ? Number(prev.pricePerUnit) || 0 : null
    const nextPrice = next?.type && next.type !== 'none' ? Number(next.pricePerUnit) || 0 : null
    const prevType = prev?.type && prev.type !== 'none' ? prev.type : null
    const nextType = next?.type && next.type !== 'none' ? next.type : null
    if (prevPrice === nextPrice && prevType === nextType) continue
    const name = after[i]?.name || `Ítem ${i + 1}`
    const fmt = (type: string | null, price: number | null) =>
      type ? `${packagingLabel(type)} $${(price || 0).toLocaleString('es-CL')}/m³` : 'sin embalaje'
    changes.push(`${name}: ${fmt(prevType, prevPrice)} → ${fmt(nextType, nextPrice)}`)
  }
  return changes
}

