// Capacidad operativa de la flota para el cálculo de disponibilidad.
// La capacidad = número de vehículos ACTIVOS. Si aún no se han materializado
// vehículos individuales (columna `vehicles` vacía), caemos a `num_vehicles`
// para preservar el comportamiento previo.

export type VehicleStatus = 'active' | 'maintenance'

export interface FleetVehicle {
  id: number
  name: string
  capacity?: number
  driver?: string
  phone?: string
  status: VehicleStatus
  /** Clave de color (ver src/lib/vehicleColors.ts). Ausente en flotas antiguas. */
  color?: string
  /**
   * Token del link privado de este camión: /trabajos/<accessToken>. Ausente mientras
   * el admin no lo haya generado; en ese caso el camión simplemente no tiene link.
   * NUNCA debe salir de una respuesta que no exija sesión de admin.
   */
  accessToken?: string
  /**
   * PIN de este camión. Ausente = se usa el PIN general (env DRIVER_PIN), para que un
   * camión recién creado funcione sin configurar nada. Mismo cuidado que accessToken:
   * no puede viajar a ninguna superficie pública.
   */
  pin?: string
}

export interface FleetConfigRow {
  num_vehicles?: number | null
  vehicles?: unknown
}

export function getFleetVehicles(config: FleetConfigRow | null | undefined): FleetVehicle[] {
  if (!config || !Array.isArray(config.vehicles)) return []
  return config.vehicles as FleetVehicle[]
}

export function getActiveCapacity(config: FleetConfigRow | null | undefined): number {
  if (!config) return 0
  const vehicles = getFleetVehicles(config)
  if (vehicles.length > 0) {
    return vehicles.filter((v) => v && v.status === 'active').length
  }
  return Math.max(0, Number(config.num_vehicles) || 0)
}
