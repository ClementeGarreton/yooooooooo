/**
 * SERVICIO DE SERVICIOS ADICIONALES
 * 
 * Este servicio proporciona los servicios adicionales disponibles
 * basados en la configuración de precios de la base de datos.
 */

import { getPricingConfig } from '@/lib/pricingService'
import { DEFAULT_EXTRA_SERVICES, hasFridge, type PricedItem } from '@/lib/extraServices'
import { Wrench, Package, Refrigerator, Zap } from 'lucide-react'

export interface AdditionalService {
  id: string
  name: string
  description: string
  icon: any
  price: number
  requiresContact?: boolean // Si es true, muestra mensaje de contacto con ejecutivo
  contactMessage?: string // Mensaje personalizado para contacto
}

/**
 * Servicios adicionales ofrecibles para esta cotización.
 *
 * `items` importa: el desarmado de refrigerador SOLO se ofrece si hay un refrigerador
 * en la lista. Sin los items (llamada sin argumento) se comporta como antes y ese
 * servicio no aparece — es el default seguro: no ofrecer algo que no aplica.
 */
export async function getAdditionalServices(
  items: PricedItem[] = []
): Promise<AdditionalService[]> {
  const fridgePresent = hasFridge(items)
  try {
    const pricing = await getPricingConfig()

    const services: AdditionalService[] = [
      {
        id: 'disassembly',
        name: 'Desarme de Muebles',
        description: 'Desmontaje profesional de camas, roperos, estantes, etc.',
        icon: Wrench,
        price: pricing.additionalServices.disassembly
      },
      {
        id: 'assembly',
        name: 'Armado de Muebles',
        description: 'Montaje de todos tus muebles en el destino',
        icon: Wrench,
        price: pricing.additionalServices.assembly
      },
      {
        id: 'packing',
        name: 'Armado de Cajas',
        description: 'Empaque seguro de objetos frágiles y delicados',
        icon: Package,
        price: 0,
        requiresContact: true,
        contactMessage: 'Para contratar este servicio, habla con un ejecutivo'
      },
      {
        id: 'unpacking',
        name: 'Desembalaje',
        description: 'Desempaque y ubicación de items en destino',
        icon: Package,
        price: 0,
        requiresContact: true,
        contactMessage: 'Para contratar este servicio, habla con un ejecutivo'
      },
      {
        id: 'priority',
        name: 'Priority',
        description: 'Agenda libre: eliges el día y la hora que te sirven, sin depender de los cupos disponibles',
        icon: Zap,
        price: pricing.additionalServices.priority
      }
    ]

    if (fridgePresent) {
      services.push({
        id: 'fridgeDisassembly',
        name: 'Desarmado de Refrigerador',
        description: 'Desmontaje y preparación del refrigerador para el traslado',
        icon: Refrigerator,
        price: pricing.additionalServices.fridgeDisassembly
      })
    }

    // Un servicio con precio 0 y sin `requiresContact` es uno apagado desde Precios:
    // no se ofrece, en vez de ofrecerse gratis.
    return services.filter((s) => s.requiresContact || s.price > 0)
  } catch (error) {
    console.error('Error getting additional services:', error)

    // Devolver servicios por defecto si falla
    const fallback: AdditionalService[] = [
      {
        id: 'disassembly',
        name: 'Desarme de Muebles',
        description: 'Desmontaje profesional de camas, roperos, estantes, etc.',
        icon: Wrench,
        price: 15000
      },
      {
        id: 'assembly',
        name: 'Armado de Muebles',
        description: 'Montaje de todos tus muebles en el destino',
        icon: Wrench,
        price: 15000
      },
      {
        id: 'packing',
        name: 'Armado de Cajas',
        description: 'Empaque seguro de objetos frágiles y delicados',
        icon: Package,
        price: 0,
        requiresContact: true,
        contactMessage: 'Para contratar este servicio, habla con un ejecutivo'
      },
      {
        id: 'unpacking',
        name: 'Desembalaje',
        description: 'Desempaque y ubicación de items en destino',
        icon: Package,
        price: 0,
        requiresContact: true,
        contactMessage: 'Para contratar este servicio, habla con un ejecutivo'
      },
      {
        id: 'priority',
        name: 'Priority',
        description: 'Agenda libre: eliges el día y la hora que te sirven, sin depender de los cupos disponibles',
        icon: Zap,
        price: DEFAULT_EXTRA_SERVICES.priority
      }
    ]

    if (fridgePresent) {
      fallback.push({
        id: 'fridgeDisassembly',
        name: 'Desarmado de Refrigerador',
        description: 'Desmontaje y preparación del refrigerador para el traslado',
        icon: Refrigerator,
        price: DEFAULT_EXTRA_SERVICES.fridgeDisassembly
      })
    }

    return fallback
  }
}
