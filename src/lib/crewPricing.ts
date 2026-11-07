// Cuadrilla y escaleras: las dos reglas del precio que dependen de CÓMO se carga,
// no de cuánto ocupa.
//
// CUADRILLA — la define el artículo MÁS PESADO, no la suma. Los bultos se cargan de a
// uno: tres muebles de 60 kg siguen necesitando las mismas dos personas, pero uno solo
// de 200 kg necesita cuatro. Por eso acá nunca se suman pesos.
//
// ESCALERAS — el cargo por piso se multiplica por la cantidad de viajes que implica la
// carga. Antes era plano (piso × tarifa), o sea que subir un velador a un 3º costaba lo
// mismo que subir treinta bultos.

export interface CrewConfig {
  /** Personas que ya vienen en el precio base (el chofer). */
  includedPeople: number
  /** Cada tramo de estos kilos en un mismo bulto suma una persona. */
  kgPerPerson: number
  /** Precio de cada persona por sobre las incluidas. */
  pricePerExtraPerson: number
  /** Tope del selector de ayudantes del paso 6. */
  maxPeople: number
}

export interface StairsConfig {
  /** Cada tantos artículos se repite el cargo por piso (un "viaje" más). */
  itemsPerTrip: number
}

export const DEFAULT_CREW: CrewConfig = {
  includedPeople: 1,
  kgPerPerson: 50,
  pricePerExtraPerson: 20000,
  maxPeople: 10,
}

export const DEFAULT_STAIRS: StairsConfig = {
  itemsPerTrip: 5,
}

/** Sobre esta cantidad de bultos el servicio deja de ser un flete y se cotiza aparte. */
export const FULL_MOVE_ITEM_THRESHOLD = 12

export interface WeighedItem {
  weight: number
  quantity: number
}

/** Peso del bulto individual más pesado. Es lo que define cuánta gente hace falta. */
export function heaviestItemWeight(items: WeighedItem[]): number {
  return items.reduce((max, item) => Math.max(max, Number(item.weight) || 0), 0)
}

/** Cantidad total de bultos (suma de cantidades, no de líneas del catálogo). */
export function totalUnits(items: WeighedItem[]): number {
  return items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0)
}

/**
 * Personas que el trabajo exige por peso. 50 kg se mantiene en una persona; 51 kg ya
 * pide dos, y 200 kg pide cuatro.
 */
export function requiredPeople(items: WeighedItem[], config: CrewConfig = DEFAULT_CREW): number {
  const kgPerPerson = config.kgPerPerson > 0 ? config.kgPerPerson : DEFAULT_CREW.kgPerPerson
  const byWeight = Math.ceil(heaviestItemWeight(items) / kgPerPerson)
  return Math.max(1, config.includedPeople, byWeight)
}

/**
 * Costo de la cuadrilla. `totalPeople` incluye a las personas obligatorias por peso más
 * los ayudantes que el cliente haya agregado; solo se cobran las que exceden las incluidas.
 */
export function crewCost(totalPeople: number, config: CrewConfig = DEFAULT_CREW): number {
  const extra = Math.max(0, totalPeople - config.includedPeople)
  return extra * config.pricePerExtraPerson
}

/** Viajes por escalera que implica la carga. Siempre al menos uno. */
export function stairTrips(items: WeighedItem[], config: StairsConfig = DEFAULT_STAIRS): number {
  const perTrip = config.itemsPerTrip > 0 ? config.itemsPerTrip : DEFAULT_STAIRS.itemsPerTrip
  return Math.max(1, Math.ceil(totalUnits(items) / perTrip))
}

/**
 * Cargo por subir a un piso sin ascensor. Devuelve 0 si hay ascensor o es planta baja.
 */
export function stairsCost(
  floor: number | null | undefined,
  hasElevator: boolean | null | undefined,
  items: WeighedItem[],
  floorSurcharge: number,
  config: StairsConfig = DEFAULT_STAIRS
): number {
  if (hasElevator) return 0
  const floors = Math.max(0, Number(floor) || 0)
  if (floors === 0) return 0
  return floors * floorSurcharge * stairTrips(items, config)
}

/** Un servicio con muchos bultos ya no es un flete: se ofrece cotización personalizada. */
export function isFullMove(items: WeighedItem[]): boolean {
  return totalUnits(items) > FULL_MOVE_ITEM_THRESHOLD
}
