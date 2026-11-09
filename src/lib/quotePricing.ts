/**
 * CÁLCULO DEL PRECIO DE UNA COTIZACIÓN — la única fuente de verdad.
 *
 * Vivía dentro de `calculateTotals()` en `src/store/quoteStore.ts`, o sea del lado del
 * navegador: la API recibía el total ya calculado y solo lo guardaba. Cualquier otro
 * canal que tuviera que cotizar —el chatbot, que no tiene browser— habría tenido que
 * replicar la fórmula, y dos copias se separan el día que Tomás edita `pricing_config`.
 *
 * Acá adentro no hay red ni estado: entra todo resuelto (items, configuración de precios
 * y la distancia ya medida) y sale el número. Quién lee la configuración y quién mide la
 * distancia es problema del que llama —el store en la web, el endpoint en el servidor—,
 * y por eso el mismo cálculo sirve en los dos lados.
 *
 * EL ORDEN DE LAS SUMAS ES PARTE DE LA DEFINICIÓN DEL PRECIO, no un detalle: el recargo
 * de sábado, domingo o feriado y el descuento por flexibilidad son porcentajes, así que mover
 * un cargo de lugar cambia la plata. Cada tramo dice por qué está donde está.
 */

import { crewCost, requiredPeople, stairTrips, stairsCost } from '@/lib/crewPricing'
import { hasFridge, overCapacitySurcharge } from '@/lib/extraServices'
import type { PricingConfig } from '@/lib/pricingService'
import { chileDateKey, dayOfWeekFromKey, isChileHoliday } from '@/lib/chileHolidays'

/** Un item de la mudanza, con lo único que el precio necesita saber de él. */
export interface QuoteItemInput {
  id?: string
  name?: string
  volume: number
  weight: number
  quantity: number
  isFragile?: boolean
  isGlass?: boolean
  packaging?: {
    type: string
    pricePerUnit: number
  }
}

/** Piso y ascensor de una punta del traslado. */
export interface QuotePropertyInput {
  floor?: number
  hasElevator?: boolean
}

/** Los servicios que el cliente marcó. Solo los que mueven el precio. */
export interface QuoteServicesInput {
  packing?: boolean
  unpacking?: boolean
  disassembly?: boolean
  assembly?: boolean
  fridgeDisassembly?: boolean
  priority?: boolean
  extraHelpers?: number
}

export interface QuotePricingInput {
  items: QuoteItemInput[]
  origin?: QuotePropertyInput | null
  destination?: QuotePropertyInput | null
  /** Distancia de la ruta completa, con las paradas ya sumadas. La mide el que llama. */
  distanceKm: number
  /** Lista efectiva de bultos que subirán por escalera. Si se omite, se conserva el comportamiento de la web. */
  originStairItems?: QuoteItemInput[]
  destinationStairItems?: QuoteItemInput[]
  /** Fecha de la mudanza: define el recargo de sábado, domingo o feriado. */
  dateTime?: string | Date | null
  isFlexible?: boolean
  /**
   * Empresa = se factura. NO cambia el precio: los precios ya incluyen IVA, también para
   * empresas (Tomás, 23-10-2026). Antes se sumaba un 19 % y la web cotizaba más caro que el
   * panel cuando una de las dos marcaba «empresa».
   */
  isCompany?: boolean
  additionalServices?: QuoteServicesInput | null
  pricing: PricingConfig
}

/** Partidas del cálculo REAL: se generan durante la misma operación que calcula el total. */
export interface QuotePriceComponent {
  key: string
  label: string
  amount: number
}

export interface QuotePricingResult {
  totalVolume: number
  totalWeight: number
  estimatedPrice: number
  recommendedVehicle: string
  /** Personas que obliga el peso del bulto más pesado. */
  requiredCrew: number
  /** Las anteriores más los ayudantes que sumó el cliente, topeado en `crew.maxPeople`. */
  totalCrew: number
  stairTrips: number
  priceBreakdown: QuotePriceComponent[]
}

export type DateSurchargeKind = 'saturday' | 'sunday' | 'holiday'

export interface DateSurcharge {
  percent: number
  /** El recargo que se aplicó; `null` si el día no lleva ninguno. */
  kind: DateSurchargeKind | null
}

/**
 * Recargo por el día de la mudanza. Lo usan el cálculo y el calendario, para que el
 * «+15%» que ve el cliente sea el mismo que se le cobra.
 *
 * Un feriado que cae en domingo NO suma los dos: se cobra el mayor. Son dos razones para
 * lo mismo (un día en que no se trabaja), no dos cargos distintos.
 *
 * Antes sábado y domingo usaban los dos el porcentaje del sábado, y el de domingo y el de
 * feriado se editaban en el panel sin mover el precio.
 */
export function dateSurcharge(
  dateTime: string | Date | null | undefined,
  surcharges: { saturday?: number; sunday?: number; holiday?: number } | null | undefined
): DateSurcharge {
  const dateKey = chileDateKey(dateTime)
  if (!dateKey || !surcharges) return { percent: 0, kind: null }

  const candidatos: DateSurcharge[] = []
  const dia = dayOfWeekFromKey(dateKey)
  if (dia === 6) candidatos.push({ percent: Number(surcharges.saturday) || 0, kind: 'saturday' })
  if (dia === 0) candidatos.push({ percent: Number(surcharges.sunday) || 0, kind: 'sunday' })
  if (isChileHoliday(dateKey)) {
    candidatos.push({ percent: Number(surcharges.holiday) || 0, kind: 'holiday' })
  }

  const mayor = candidatos
    .filter((c) => c.percent > 0)
    .sort((a, b) => b.percent - a.percent)[0]
  return mayor || { percent: 0, kind: null }
}

/** Vehículo que se recomienda para ese volumen. Informativo: no entra en el precio. */
export function recommendVehicle(totalVolumeM3: number): string {
  if (totalVolumeM3 > 20) return 'Furgón Grande'
  if (totalVolumeM3 > 10) return 'Furgón Mediano'
  if (totalVolumeM3 > 5) return 'Camioneta Grande'
  return 'Camioneta'
}

export function totalVolumeOf(items: QuoteItemInput[]): number {
  return (items || []).reduce((sum, item) => sum + (item.volume || 0) * (item.quantity || 0), 0)
}

export function totalWeightOf(items: QuoteItemInput[]): number {
  return (items || []).reduce((sum, item) => sum + (item.weight || 0) * (item.quantity || 0), 0)
}

export function calculateQuote(input: QuotePricingInput): QuotePricingResult {
  const items = input.items || []
  const pricing = input.pricing
  const services = input.additionalServices || {}

  const totalVolume = totalVolumeOf(items)
  const totalWeight = totalWeightOf(items)
  const recommendedVehicle = recommendVehicle(totalVolume)
  const distance = Number.isFinite(input.distanceKm) ? input.distanceKm : 0

  const components: QuotePriceComponent[] = []
  let basePrice = 0
  const charge = (key: string, label: string, amount: number) => {
    if (!Number.isFinite(amount)) throw new Error(`Partida inválida: ${key}`)
    components.push({ key, label, amount })
    basePrice += amount
  }
  const pesos = (amount: number) => Math.round(amount).toLocaleString('es-CL')

  charge('base', 'Tarifa base', pricing.basePrice)
  charge('volume', `Volumen: ${totalVolume.toFixed(2)} m³ × $${pesos(pricing.pricePerCubicMeter)}/m³`,
    totalVolume * pricing.pricePerCubicMeter)

  const freeKilometers = pricing.freeKilometers ?? 50
  const chargeableKm = Math.max(0, distance - freeKilometers)
  charge('distance', `Ruta: ${distance.toFixed(2)} km (${freeKilometers} incluidos; ${chargeableKm.toFixed(2)} facturables) × $${pesos(pricing.pricePerKilometer)}/km`,
    chargeableKm * pricing.pricePerKilometer)

  const trips = stairTrips(items, pricing.stairs)
  const floorsOrigin = Math.max(0, Number(input.origin?.floor) || 0)
  const floorsDestination = Math.max(0, Number(input.destination?.floor) || 0)
  charge('stairs_origin', `Escaleras origen: ${floorsOrigin} piso(s), ${stairTrips(input.originStairItems ?? items, pricing.stairs)} viaje(s), $${pesos(pricing.floorSurcharge)}/piso/viaje`,
    stairsCost(input.origin?.floor, input.origin?.hasElevator, input.originStairItems ?? items, pricing.floorSurcharge, pricing.stairs))
  charge('stairs_destination', `Escaleras destino: ${floorsDestination} piso(s), ${stairTrips(input.destinationStairItems ?? items, pricing.stairs)} viaje(s), $${pesos(pricing.floorSurcharge)}/piso/viaje`,
    stairsCost(input.destination?.floor, input.destination?.hasElevator, input.destinationStairItems ?? items, pricing.floorSurcharge, pricing.stairs))

  const crewByWeight = requiredPeople(items, pricing.crew)
  const totalCrew = Math.min(pricing.crew.maxPeople,
    crewByWeight + Math.max(0, services.extraHelpers || 0))
  charge('crew', `Cuadrilla: ${totalCrew} persona(s), ${pricing.crew.includedPeople} incluida(s)`,
    crewCost(totalCrew, pricing.crew))

  // Mantener el ORDEN de la fórmula anterior: el recargo de fecha se aplica aquí,
  // antes de servicios adicionales, embalajes y descuentos.
  const recargoDia = dateSurcharge(input.dateTime, pricing.timeSurcharges)
  if (recargoDia.percent > 0) {
    charge('day_surcharge', `Recargo ${recargoDia.kind || 'fecha'}: ${recargoDia.percent}%`,
      (basePrice * recargoDia.percent) / 100)
  }

  if (services.disassembly) charge('disassembly', 'Desarmado', pricing.additionalServices.disassembly)
  if (services.assembly) charge('assembly', 'Armado', pricing.additionalServices.assembly)
  if (services.packing) charge('packing', 'Embalaje', pricing.additionalServices.packing)
  if (services.unpacking) charge('unpacking', 'Desembalaje', pricing.additionalServices.unpacking)
  if (services.fridgeDisassembly && hasFridge(items)) {
    charge('fridge_disassembly', 'Desarmado de refrigerador', pricing.additionalServices.fridgeDisassembly)
  }

  const packagingCost = items
    .filter((item) => item.packaging && item.packaging.type !== 'none')
    .reduce((acc, item) => {
      const itemVolume = (item.volume || 0) * (item.quantity || 0)
      const itemPackagingCost = item.packaging?.pricePerUnit || 0
      return acc + itemPackagingCost * itemVolume
    }, 0)
  if (packagingCost) charge('special_packaging', 'Embalaje especial por volumen', packagingCost)

  const fragileCount = items.filter((item) => item.isFragile || item.isGlass).length
  if (fragileCount) charge('fragile', `Artículos frágiles: ${fragileCount} tipo(s)`,
    fragileCount * pricing.specialPackaging.fragile)

  if (input.isFlexible) {
    charge('flexibility_discount', `Descuento por flexibilidad: ${pricing.discounts.flexibility}%`,
      -(basePrice * pricing.discounts.flexibility) / 100)
  }

  const excess = overCapacitySurcharge(totalVolume, pricing.additionalServices)
  if (excess) charge('overcapacity', 'Recargo por exceso de volumen', excess)
  if (services.priority) charge('priority', 'Servicio prioritario', pricing.additionalServices.priority)

  const estimatedPrice = Math.round(basePrice)
  // Redondeo por acumulación: suma EXACTA de partidas en pesos = total cobrado.
  let runningExact = 0
  let runningRounded = 0
  const priceBreakdown = components.map((component) => {
    runningExact += component.amount
    const cumulativeRounded = Math.round(runningExact)
    const amount = cumulativeRounded - runningRounded
    runningRounded = cumulativeRounded
    return { ...component, amount }
  })
  if (runningRounded !== estimatedPrice) throw new Error('Descuadre del desglose de cotización')

  return {
    totalVolume,
    totalWeight,
    estimatedPrice,
    recommendedVehicle,
    requiredCrew: crewByWeight,
    totalCrew,
    stairTrips: trips,
    priceBreakdown,
  }
}
