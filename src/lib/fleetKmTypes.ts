// Tipos del kilometraje de la flota, SIN dependencias de servidor (los usa el componente).

export interface VehicleKm {
  vehicleId: number
  name: string
  driver: string
  status: 'active' | 'maintenance'
  plate: string | null
  brand: string | null
  /** Última lectura del tablero cargada a mano, y su fecha. null = nunca se cargó. */
  odometerKm: number | null
  odometerAt: string | null
  /** Trabajos del camión desde esa lectura (o desde siempre, si no hay lectura). */
  jobsCount: number
  /** De esos, cuántos tienen la distancia guardada; solo esos suman. */
  jobsWithDistance: number
  /** Suma de esas distancias, en km (origen → destino, sin traslados en vacío). */
  jobsKm: number
  /** Lectura + km de trabajos. null si nunca se cargó una lectura. */
  estimatedKm: number | null
}
