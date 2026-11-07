/**
 * SERVICIOS Y RECARGOS AGREGADOS EN SEPTIEMBRE 2026
 *
 * Tres cobros que antes se hacían por fuera del cotizador (reunión con Tomás, 1-sep-2026):
 *
 *  - Desarmado de refrigerador: servicio opcional que SOLO tiene sentido ofrecer si el
 *    cliente cargó un refrigerador. Ofrecerlo siempre ensucia la lista y confunde.
 *  - Recargo por exceso de volumen: sobre cierto m³ no entra en un camión y hay que
 *    mandar otro o hacer dos viajes. Antes se cobraba como un viaje solo, así que a más
 *    volumen peor era el margen.
 *  - Priority: agenda libre con horario flexible, por encima de la disponibilidad normal.
 *
 * Todo acá es función pura: recibe items y configuración, devuelve números. El orden en
 * que estos cobros entran al total lo decide `quoteStore.ts`, no este archivo.
 */

/** Un item, visto por estas reglas. Sirve tanto para el store como para el panel admin. */
export interface PricedItem {
  id?: string
  name?: string
  volume?: number
  quantity?: number
}

export interface ExtraServicesConfig {
  /** Precio del desarmado de refrigerador. 0 = servicio apagado. */
  fridgeDisassembly: number
  /** Precio del servicio Priority. 0 = apagado. */
  priority: number
  /** m³ a partir de los cuales se cobra el recargo. 0 = recargo apagado. */
  overCapacityThresholdM3: number
  /** Monto del recargo por exceso de volumen. */
  overCapacityPrice: number
  /**
   * Repaletizar, en el servicio de pallets del panel de empresas (Tomás, 20-10-2026).
   * 0 = sin monto definido: se ofrece igual y se cotiza aparte.
   */
  repalletize: number
}

export const DEFAULT_EXTRA_SERVICES: ExtraServicesConfig = {
  fridgeDisassembly: 45000,
  priority: 99990,
  overCapacityThresholdM3: 23,
  overCapacityPrice: 29990,
  repalletize: 0,
}

/** Normaliza para comparar nombres: sin tildes, sin mayúsculas. */
function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

/**
 * ¿Hay un refrigerador entre los items?
 *
 * Se mira el id Y el nombre a propósito. El catálogo estático trae `id: 'refrigerador'`,
 * pero los items también se editan desde el panel (`catalog_items`) y ahí un
 * "Refrigerador side by side" nuevo puede tener cualquier id. Con el nombre se cubren
 * los dos casos, y "Freezer" entra porque es el mismo trabajo de desarmado.
 */
export function hasFridge(items: PricedItem[] | null | undefined): boolean {
  return (items || []).some((item) => {
    const quantity = Number(item?.quantity)
    // Un item con cantidad 0 está en la lista pero no se mueve.
    if (Number.isFinite(quantity) && quantity <= 0) return false
    const haystack = normalize(`${item?.id || ''} ${item?.name || ''}`)
    return haystack.includes('refriger') || haystack.includes('freezer')
  })
}

/**
 * Recargo por pasarse del volumen de un camión. Es todo o nada, no proporcional: el
 * costo real es "hay que mandar un segundo camión", y ese costo no crece suave.
 *
 * Devuelve 0 si el recargo está apagado (precio o umbral en 0), que es como se
 * comporta el resto de los cargos configurables del sistema.
 */
export function overCapacitySurcharge(
  totalVolumeM3: number,
  config: Pick<ExtraServicesConfig, 'overCapacityThresholdM3' | 'overCapacityPrice'>
): number {
  const threshold = Number(config?.overCapacityThresholdM3) || 0
  const price = Number(config?.overCapacityPrice) || 0
  if (threshold <= 0 || price <= 0) return 0
  const volume = Number(totalVolumeM3) || 0
  return volume > threshold ? price : 0
}

/** Cuántos camiones hacen falta para ese volumen. Solo informativo, para la vista. */
export function trucksNeeded(totalVolumeM3: number, thresholdM3: number): number {
  const threshold = Number(thresholdM3) || 0
  if (threshold <= 0) return 1
  return Math.max(1, Math.ceil((Number(totalVolumeM3) || 0) / threshold))
}

/** Normaliza la configuración leída de la BD contra los valores por defecto. */
export function withExtraServicesDefaults(raw: unknown): ExtraServicesConfig {
  const c = (raw || {}) as Partial<ExtraServicesConfig>
  const num = (v: unknown, fallback: number) =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback
  return {
    fridgeDisassembly: num(c.fridgeDisassembly, DEFAULT_EXTRA_SERVICES.fridgeDisassembly),
    priority: num(c.priority, DEFAULT_EXTRA_SERVICES.priority),
    overCapacityThresholdM3: num(
      c.overCapacityThresholdM3,
      DEFAULT_EXTRA_SERVICES.overCapacityThresholdM3
    ),
    overCapacityPrice: num(c.overCapacityPrice, DEFAULT_EXTRA_SERVICES.overCapacityPrice),
    repalletize: num(c.repalletize, DEFAULT_EXTRA_SERVICES.repalletize),
  }
}
