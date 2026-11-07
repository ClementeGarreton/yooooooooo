import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { getPricingConfig } from '@/lib/pricingService'
import { calculateRouteDistance } from '@/lib/mapsService'
import { calculateQuote } from '@/lib/quotePricing'

export interface PersonalInfo {
  name: string
  email: string
  phone: string
  /** RUT de la persona. Opcional: se guarda como «declarado» para su cuenta de cliente. */
  rut?: string
  isCompany: boolean
  companyName?: string
  companyRut?: string
}

export interface Address {
  street: string
  number: string
  commune: string
  region: string
  additionalInfo?: string
  coordinates?: {
    lat: number
    lng: number
  }
}

/**
 * Parada intermedia entre el origen y el destino. El camión pasa por ellas en orden.
 * `note` es para que el chofer sepa qué hace ahí (cargar, dejar, retirar algo).
 */
export interface Stop {
  street: string
  number: string
  commune: string
  region: string
  additionalInfo?: string
  note?: string
}

export interface PropertyDetails {
  propertyType: 'casa' | 'departamento' | 'oficina' | 'bodega' | 'otro'
  floor: number
  hasElevator: boolean
  parkingDistance: number
}

export interface PackagingOption {
  id: string
  name: string
  price: number
  description: string
}

export interface Item {
  id: string
  name: string
  category: string
  volume: number
  weight: number
  quantity: number
  isFragile: boolean
  isHeavy: boolean
  isGlass: boolean
  image?: string
  packaging?: {
    type: string
    pricePerUnit: number
  }
}

export interface AdditionalServices {
  disassembly: boolean
  assembly: boolean
  packing: boolean
  unpacking: boolean
  observations: string
  photos: string[]
  /**
   * Ayudantes que el cliente agrega POR SOBRE los que el peso ya obliga a mandar.
   * Más gente = más rápido y con más cuidado; no reemplaza a la cuadrilla mínima.
   */
  extraHelpers: number
  /**
   * Desarmado de refrigerador. Solo se ofrece si hay un refrigerador entre los items
   * (ver `hasFridge`); si el cliente lo saca de la lista después de haberlo marcado,
   * el cargo se cae solo en el cálculo.
   */
  fridgeDisassembly: boolean
  /** Priority: agenda libre con horario flexible, por encima de la disponibilidad normal. */
  priority: boolean
  /**
   * Hay muebles o bultos grandes que no caben en el ascensor y van por la escalera, aunque
   * el edificio tenga ascensor. No cambia el precio: es un aviso para el equipo.
   * Opcional: las cotizaciones guardadas antes de oct-2026 no lo traen.
   */
  stairsCarry?: boolean
}

export interface QuoteState {
  personalInfo: PersonalInfo | null
  dateTime: Date | null
  isFlexible: boolean
  origin: {
    address: Address | null
    details: PropertyDetails | null
  }
  destination: {
    address: Address | null
    details: PropertyDetails | null
  }
  /** Paradas intermedias, en el orden en que el camión pasa por ellas. */
  stops: Stop[]
  items: Item[]
  additionalServices: AdditionalServices
  totalVolume: number
  totalWeight: number
  totalDistance: number // km calculados (real o estimado)
  estimatedPrice: number
  recommendedVehicle: string
  /** Personas que el peso obliga a mandar (sin contar los ayudantes agregados). */
  requiredCrew: number
  /** Cuadrilla total cotizada: obligatorias + ayudantes extra. */
  totalCrew: number
  /** Viajes por escalera que implica la cantidad de bultos. */
  stairTrips: number
  isConfirmed: boolean

  // Actions
  setPersonalInfo: (info: PersonalInfo) => void
  setDateTime: (date: Date, isFlexible: boolean) => void
  setOriginAddress: (address: Address) => void
  setDestinationAddress: (address: Address) => void
  setOriginDetails: (details: PropertyDetails) => void
  setDestinationDetails: (details: PropertyDetails) => void
  setStops: (stops: Stop[]) => void
  addItem: (item: Item) => void
  updateItem: (id: string, item: Partial<Item>) => void
  removeItem: (id: string) => void
  setAdditionalServices: (services: AdditionalServices) => void
  calculateTotals: () => Promise<void>
  setConfirmed: (confirmed: boolean) => void
  resetQuote: () => void
}

const initialState = {
  personalInfo: null,
  dateTime: null,
  isFlexible: false,
  origin: {
    address: null,
    details: null,
  },
  destination: {
    address: null,
    details: null,
  },
  stops: [],
  items: [],
  additionalServices: {
    disassembly: false,
    assembly: false,
    packing: false,
    unpacking: false,
    observations: '',
    photos: [],
    extraHelpers: 0,
    fridgeDisassembly: false,
    priority: false,
    stairsCarry: false,
  },
  totalVolume: 0,
  totalWeight: 0,
  totalDistance: 0,
  estimatedPrice: 0,
  recommendedVehicle: 'Camioneta',
  requiredCrew: 1,
  totalCrew: 1,
  stairTrips: 1,
  isConfirmed: false,
}

export const useQuoteStore = create<QuoteState>()(
  persist(
    (set, get) => ({
      ...initialState,

      setPersonalInfo: (info) => set({ personalInfo: info }),

      setDateTime: (date, isFlexible) => set({ dateTime: date, isFlexible }),

      setOriginAddress: (address) =>
        set((state) => ({
          origin: { ...state.origin, address },
        })),

      setDestinationAddress: (address) =>
        set((state) => ({
          destination: { ...state.destination, address },
        })),

      setStops: (stops) => set({ stops }),

      setOriginDetails: (details) =>
        set((state) => ({
          origin: { ...state.origin, details },
        })),

      setDestinationDetails: (details) =>
        set((state) => ({
          destination: { ...state.destination, details },
        })),

      addItem: (item) =>
        set((state) => {
          const newItems = [...state.items, item]
          return { items: newItems }
        }),

      updateItem: (id, updatedItem) =>
        set((state) => ({
          items: state.items.map((item) =>
            item.id === id ? { ...item, ...updatedItem } : item
          ),
        })),

      removeItem: (id) =>
        set((state) => ({
          items: state.items.filter((item) => item.id !== id),
        })),

      setAdditionalServices: (services) => set({ additionalServices: services }),

      setConfirmed: (confirmed) => set({ isConfirmed: confirmed }),

      calculateTotals: async () => {
        const state = get()

        // Este método NO calcula el precio: junta el contexto que el cálculo necesita
        // —la configuración vigente y la distancia real de la ruta— y se lo pasa a
        // `calculateQuote`, que es la única fórmula del sistema. Así el chatbot, que
        // cotiza sin navegador, llama al mismo cálculo por `/api/quote/calculate` en vez
        // de reimplementarlo y separarse el día que Tomás edita los precios.
        const pricing = await getPricingConfig()

        let distance = 10 // km por defecto

        if (state.origin.address && state.destination.address) {
          try {
            // La ruta pasa por las paradas en orden. Sin paradas, `calculateRouteDistance`
            // hace exactamente el mismo cálculo directo que antes.
            distance = await calculateRouteDistance([
              state.origin.address,
              ...(state.stops || []),
              state.destination.address,
            ])
          } catch (error) {
            console.error('Error calculating distance:', error)
            // Usar distancia por defecto si falla
          }
        }

        const result = calculateQuote({
          items: state.items,
          origin: state.origin.details,
          destination: state.destination.details,
          distanceKm: distance,
          dateTime: state.dateTime,
          isFlexible: state.isFlexible,
          isCompany: state.personalInfo?.isCompany,
          additionalServices: state.additionalServices,
          pricing,
        })

        set({
          totalVolume: result.totalVolume,
          totalWeight: result.totalWeight,
          totalDistance: distance,
          estimatedPrice: result.estimatedPrice,
          recommendedVehicle: result.recommendedVehicle,
          requiredCrew: result.requiredCrew,
          totalCrew: result.totalCrew,
          stairTrips: result.stairTrips,
        })
      },

      resetQuote: () => set(initialState),
    }),
    {
      name: 'quote-storage',
    }
  )
)

