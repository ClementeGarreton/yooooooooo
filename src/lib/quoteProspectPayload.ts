/**
 * DATOS DE UNA COTIZACIÓN PARA GUARDARLA COMO PROSPECTO.
 *
 * Vivía dentro de `SummaryStep` (el resumen del cotizador web). Desde sep-2026 también la
 * usa el cotizador interno del panel, que reutiliza los mismos pasos y el mismo store: si
 * cada uno armara su propia versión, una cotización cargada por la secretaria terminaría
 * guardada con otros campos que una hecha por el cliente, y el panel, el PDF y el link del
 * chofer leen exactamente estos campos.
 *
 * Pura: recibe el estado del cotizador y devuelve el cuerpo de la petición. La atribución
 * de Google Ads NO va acá: la agrega solo el cotizador web, porque en el panel la cookie
 * es de la secretaria y atribuiría la venta a un clic que no existió.
 */

import { format } from 'date-fns'
import { hasFridge, overCapacitySurcharge } from '@/lib/extraServices'
import { buildQuoteState } from '@/lib/quoteState'

type AnyAddress = { address?: any; details?: any } | null | undefined

export interface QuoteProspectState {
  personalInfo: any
  dateTime: Date | string | null
  isFlexible: boolean
  origin: any
  destination: any
  stops: any
  items: any[]
  additionalServices: any
  totalVolume: number
  totalWeight: number
  totalDistance: number
  estimatedPrice: number
  recommendedVehicle: string
  requiredCrew: number
  totalCrew: number
}

/** Dirección completa en una línea, igual que la escribía el resumen web. */
export function buildQuoteAddress(addr: AnyAddress): string {
  if (!addr?.address) return ''

  const parts = [
    addr.address.street,
    addr.address.number,
    addr.address.commune,
    addr.address.region,
  ].filter(Boolean)

  if (addr.address.additionalInfo) {
    parts.push(addr.address.additionalInfo)
  }

  return parts.join(', ')
}

export function buildQuoteProspectBody(
  state: QuoteProspectState,
  options: {
    source: string
    quoteId: string
    overCapacity: { overCapacityThresholdM3: number; overCapacityPrice: number }
  }
) {
  const {
    personalInfo,
    dateTime,
    isFlexible,
    origin,
    destination,
    stops,
    items,
    additionalServices,
    totalVolume,
    totalWeight,
    totalDistance,
    estimatedPrice,
    recommendedVehicle,
    requiredCrew,
    totalCrew,
  } = state

  const itemsSummary = items.map((item) => ({
    name: item.name,
    quantity: item.quantity,
    volume: parseFloat((item.volume * item.quantity).toFixed(2)),
    packaging: item.packaging && item.packaging.type !== 'none' ? item.packaging : undefined,
  }))

  return {
    source: options.source,
    quote_id: options.quoteId,
    name: personalInfo?.name,
    email: personalInfo?.email,
    phone: personalInfo?.phone,
    // RUT de la persona, si lo escribió. El servidor lo guarda como «declarado».
    rut: personalInfo?.rut || undefined,
    is_company: personalInfo?.isCompany || false,
    company_name: personalInfo?.companyName,
    company_rut: personalInfo?.companyRut,
    origin_address: buildQuoteAddress(origin),
    destination_address: buildQuoteAddress(destination),
    // Paradas intermedias. Van tal cual para que el panel, el PDF y el link del
    // chofer puedan reconstruir la ruta completa, no solo las dos puntas.
    stops,
    origin_floor: origin.details?.floor ?? null,
    origin_has_elevator: origin.details?.hasElevator ?? null,
    origin_parking_distance: origin.details?.parkingDistance ?? null,
    destination_floor: destination.details?.floor ?? null,
    destination_has_elevator: destination.details?.hasElevator ?? null,
    destination_parking_distance: destination.details?.parkingDistance ?? null,
    scheduled_date: dateTime ? format(new Date(dateTime), 'yyyy-MM-dd') : null,
    scheduled_time: dateTime ? format(new Date(dateTime), 'HH:mm') : null,
    total_price: estimatedPrice,
    original_price: isFlexible ? Math.round(estimatedPrice / 0.9) : estimatedPrice,
    is_flexible: isFlexible,
    recommended_vehicle: recommendedVehicle,
    total_volume: totalVolume,
    total_weight: totalWeight,
    total_distance: totalDistance,
    items_summary: itemsSummary,
    // Copia de lo cargado, para retomar la cotización desde «Mi cuenta» (oct-2026).
    quote_state: buildQuoteState({ dateTime, isFlexible, origin, destination, stops, items, additionalServices }),
    additional_services: {
      disassembly: additionalServices.disassembly,
      assembly: additionalServices.assembly,
      packing: additionalServices.packing,
      unpacking: additionalServices.unpacking,
      observations: additionalServices.observations,
      // La cuadrilla debe sobrevivir al store del navegador: el panel admin usa
      // estos datos para regenerar tanto la cotización como la orden de trabajo.
      extraHelpers: additionalServices.extraHelpers || 0,
      requiredCrew,
      totalCrew,
      // Servicios de sep-2026. `fridgeDisassembly` se guarda sólo si el
      // refrigerador sigue en la lista, igual que en el cálculo del precio, para
      // que el panel no vea un servicio cobrado que el total no incluye.
      fridgeDisassembly: Boolean(additionalServices.fridgeDisassembly) && hasFridge(items),
      priority: Boolean(additionalServices.priority),
      // Bultos grandes que van por escalera aunque haya ascensor (oct-2026). Solo aviso
      // operativo: no toca el precio.
      stairsCarry: Boolean(additionalServices.stairsCarry),
      // El recargo por volumen es automático, no lo elige el cliente: se guarda el
      // monto aplicado para que la cotización sea reconstruible aunque después se
      // cambie el precio en el panel.
      overCapacitySurcharge: overCapacitySurcharge(totalVolume, options.overCapacity),
    },
  }
}
