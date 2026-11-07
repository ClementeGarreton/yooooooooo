/**
 * CATÁLOGO DE TIPOS DE EMBALAJE
 *
 * Un solo lugar para el id, el nombre visible y la clave de precio de cada tipo de
 * embalaje. Antes cada consumidor lo resolvía por su cuenta: `packagingService`
 * armaba las opciones del cotizador, los PDF imprimían el id crudo ("basic") y el
 * panel directamente no mostraba el embalaje de cada artículo.
 *
 * El precio vive donde ya vivía: `pricing_config.special_packaging`. Acá solo se
 * declara QUÉ clave le corresponde a cada tipo, no un sistema de precios paralelo.
 */

export type PackagingTypeId = 'none' | 'basic' | 'standard' | 'premium'

/** Claves históricas dentro de `pricing_config.special_packaging`. */
export type PackagingPricingKey = 'fragile' | 'electronics' | 'artwork'

export interface PackagingType {
  id: PackagingTypeId
  name: string
  description: string
  /** Clave en pricing_config.special_packaging que fija su precio por m³. */
  pricingKey: PackagingPricingKey | null
}

export const PACKAGING_TYPES: PackagingType[] = [
  {
    id: 'none',
    name: 'Sin Embalaje',
    description: 'El cliente se encarga del embalaje',
    pricingKey: null,
  },
  {
    id: 'basic',
    name: 'Embalaje Básico',
    description: 'Film plástico (precio por m³)',
    pricingKey: 'fragile',
  },
  {
    id: 'standard',
    name: 'Embalaje Estándar',
    description: 'Cartón corrugado (precio por m³)',
    pricingKey: 'electronics',
  },
  {
    id: 'premium',
    name: 'Embalaje Premium',
    description: 'Cartón corrugado y Film plástico (precio por m³)',
    pricingKey: 'artwork',
  },
]

const BY_ID = new Map(PACKAGING_TYPES.map((type) => [type.id, type]))

export function isPackagingTypeId(value: unknown): value is PackagingTypeId {
  return typeof value === 'string' && BY_ID.has(value as PackagingTypeId)
}

export function getPackagingType(type?: string | null): PackagingType | undefined {
  return type ? BY_ID.get(type as PackagingTypeId) : undefined
}

/**
 * Nombre legible de un tipo de embalaje. Los datos guardados traen el id
 * ("basic"), que no le dice nada a nadie fuera del código; si aparece un id
 * desconocido se devuelve tal cual en vez de esconderlo.
 */
export function packagingLabel(type?: string | null): string {
  if (!type || type === 'none') return 'Sin embalaje'
  return BY_ID.get(type as PackagingTypeId)?.name || type
}

/** Ítem tal como queda guardado en `quote_prospects.items_summary`. */
export interface PackagedItem {
  name: string
  quantity: number
  /** Volumen UNITARIO en m³ (usar `normalizeAdminPdfItems` para obtenerlo). */
  volume: number
  packaging?: { type: string; pricePerUnit?: number }
}

/** m³ de la línea completa: el volumen unitario por la cantidad. */
export function itemLineVolume(item: PackagedItem): number {
  return (Number(item.volume) || 0) * (Number(item.quantity) || 0)
}

/**
 * Costo de embalaje de una línea. Misma fórmula que el cotizador
 * (`quoteStore.calculateTotals`): precio por m³ × m³ de la línea.
 */
export function itemPackagingCost(item: PackagedItem): number {
  const type = item.packaging?.type
  if (!type || type === 'none') return 0
  const price = Number(item.packaging?.pricePerUnit)
  if (!Number.isFinite(price) || price <= 0) return 0
  return price * itemLineVolume(item)
}

export interface PackagingGroup {
  id: string
  label: string
  description?: string
  items: PackagedItem[]
  totalQuantity: number
  totalVolume: number
  totalCost: number
}

/**
 * Agrupa los artículos por tipo de embalaje para poder responder "¿qué artículos
 * entran en el Embalaje Básico?", que hasta ahora no se podía contestar desde el
 * panel: la lista mostraba los ítems sin decir con qué embalaje quedó cada uno.
 *
 * Respeta el orden del catálogo y deja "Sin embalaje" al final.
 */
export function groupItemsByPackaging(items: PackagedItem[]): PackagingGroup[] {
  const groups = new Map<string, PackagingGroup>()

  for (const item of items || []) {
    const rawType = item.packaging?.type
    const id = rawType && rawType !== 'none' ? rawType : 'none'
    let group = groups.get(id)
    if (!group) {
      group = {
        id,
        label: packagingLabel(id),
        description: getPackagingType(id)?.description,
        items: [],
        totalQuantity: 0,
        totalVolume: 0,
        totalCost: 0,
      }
      groups.set(id, group)
    }
    group.items.push(item)
    group.totalQuantity += Number(item.quantity) || 0
    group.totalVolume += itemLineVolume(item)
    group.totalCost += itemPackagingCost(item)
  }

  const order = PACKAGING_TYPES.filter((type) => type.id !== 'none').map((type) => type.id)
  return Array.from(groups.values()).sort((a, b) => {
    // "Sin embalaje" siempre último: es el grupo que menos se consulta.
    if (a.id === 'none') return 1
    if (b.id === 'none') return -1
    const ai = order.indexOf(a.id as PackagingTypeId)
    const bi = order.indexOf(b.id as PackagingTypeId)
    return (ai < 0 ? order.length : ai) - (bi < 0 ? order.length : bi)
  })
}

/** Suma del embalaje de todos los ítems: el subtotal que el ajuste puede mover. */
export function packagingSubtotal(items: PackagedItem[]): number {
  return (items || []).reduce((sum, item) => sum + itemPackagingCost(item), 0)
}
