import { supabaseAdmin } from '@/lib/supabase'
import { getFleetVehicles, type FleetVehicle } from '@/lib/fleetCapacity'
import { getDriverPin } from '@/lib/driverSession'

// Resolución del link de choferes: token de la URL → a qué camión pertenece.
//
// Hay DOS tipos de link vivos a propósito:
//
//  - Por camión (`fleet_config.vehicles[].accessToken`): el que se usa de ahora en
//    adelante. Cada camión tiene su token y su PIN, y solo muestra SUS trabajos.
//  - General (`fleet_config.driver_access_token`): el link único que existía antes.
//    Se mantiene válido para no dejar a los choferes afuera el día del deploy; muestra
//    todos los trabajos, como siempre. Regenerarlo desde el panel lo rota igual que antes.
//
// Ni el token ni el PIN de un camión pueden salir por una ruta sin sesión de admin:
// acá solo se leen del lado del servidor para decidir el acceso.

/** Scope de acceso: un camión concreto, o el link general heredado. */
export interface DriverAccess {
  kind: 'vehicle' | 'all'
  /** id del camión, o null para el link general. */
  vehicleId: number | null
  /** Nombre para encabezar la vista ("Camión 2 · Pedro"). */
  label: string
  /** PIN que hay que exigir para este link. */
  pin: string
  /** Clave corta que se firma en la cookie de sesión: 'all' o 'v<id>'. */
  scope: string
}

/** Clave de scope de un camión. Sin puntos: la cookie firmada separa por puntos. */
export function vehicleScope(vehicleId: number): string {
  return `v${vehicleId}`
}

function vehicleLabel(v: FleetVehicle, index: number): string {
  const name = v.name?.trim() || `Camión ${index + 1}`
  const driver = v.driver?.trim()
  return driver ? `${name} · ${driver}` : name
}

/** PIN efectivo de un camión: el suyo si lo tiene, si no el general. */
export function effectiveVehiclePin(v: Pick<FleetVehicle, 'pin'>): string {
  const own = typeof v.pin === 'string' ? v.pin.trim() : ''
  return own || getDriverPin()
}

/**
 * Devuelve a qué da acceso un token, o null si no corresponde a ninguno.
 * Se consulta en cada carga: revocar un link es borrar/rotar su token, sin más.
 */
export async function resolveDriverAccess(token: string): Promise<DriverAccess | null> {
  const candidate = String(token || '')
  if (!candidate) return null

  const { data } = await supabaseAdmin.from('fleet_config').select('*').single()
  if (!data) return null

  const vehicles = getFleetVehicles(data)
  const index = vehicles.findIndex(
    (v) => typeof v?.accessToken === 'string' && v.accessToken.length > 0 && v.accessToken === candidate
  )

  if (index !== -1) {
    const vehicle = vehicles[index]
    return {
      kind: 'vehicle',
      vehicleId: vehicle.id,
      label: vehicleLabel(vehicle, index),
      pin: effectiveVehiclePin(vehicle),
      scope: vehicleScope(vehicle.id),
    }
  }

  const legacy = (data as { driver_access_token?: string | null }).driver_access_token
  if (typeof legacy === 'string' && legacy.length > 0 && legacy === candidate) {
    return {
      kind: 'all',
      vehicleId: null,
      label: 'Todos los camiones',
      pin: getDriverPin(),
      scope: 'all',
    }
  }

  return null
}
