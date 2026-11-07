/**
 * «Camión asignado» del Panel del Cliente: nombre + patente + chofer (Tomás, 06-11-2026:
 * «hoy a los clientes solo les dice el camión 1, 2 o 3; también muéstreles la patente del
 * vehículo y el chofer para cada trabajo»).
 *
 * Los datos vienen de tres lados:
 *  - `fleet_config.vehicles` → nombre del camión y chofer DESIGNADO en el panel de Flota.
 *  - `vehicle_details`       → patente (add_vehicle_details.sql). Si la migración no está
 *                              corrida o la ficha está vacía, se muestra sin patente.
 *  - `booking_workers` + `workers.role` → el chofer que va EN LA CUADRILLA de este trabajo,
 *                              que manda sobre el designado en Flota: es el que va a ir.
 *
 * Nada de acá puede romper la página de la reserva: cualquier lectura fallida muestra menos
 * dato, nunca un error. Y NADA de esto puede salir con accessToken ni pin del camión — el
 * resolver devuelve un objeto nuevo con solo nombre, patente y chofer.
 */

import { supabaseAdmin } from '@/lib/supabase'
import { getFleetVehicles, type FleetConfigRow } from '@/lib/fleetCapacity'

export interface CustomerAssignment {
  vehicleName: string
  plate: string | null
  driver: string | null
}

/** Caso de prueba del resolver: flota y choferes entrantes, sin base de datos. */
export interface AssignmentInput {
  vehicleId: number | null | undefined
  vehicles: Array<{ id: number; name?: string | null; driver?: string | null }>
  plate?: string | null
  crewChofers: Array<{ name: string | null }>
}

/**
 * Arma lo que ve el cliente. `null` = no hay camión asignado todavía (no se muestra nada).
 * Chofer: primero el de la cuadrilla con rol 'chofer' (si son varios, orden estable por
 * nombre); si no hay ninguno en la cuadrilla, el designado en Flota.
 */
export function resolveCustomerAssignment(args: AssignmentInput): CustomerAssignment | null {
  if (args.vehicleId == null) return null
  const vehicle = args.vehicles.find((v) => v.id === args.vehicleId)
  const vehicleName = String(vehicle?.name || '').trim() || `Camión ${args.vehicleId}`
  const crewDriver =
    args.crewChofers
      .map((c) => String(c.name || '').trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, 'es'))[0] ?? null
  const fleetDriver = String(vehicle?.driver || '').trim() || null
  const plate = String(args.plate || '').trim().toUpperCase() || null
  return { vehicleName, plate, driver: crewDriver || fleetDriver }
}

/** Datos del camión del trabajo para el cliente. Cualquier fallo de lectura = menos dato, no error. */
export async function getCustomerAssignment(
  bookingId: string,
  vehicleId: number | null | undefined
): Promise<CustomerAssignment | null> {
  if (vehicleId == null) return null
  try {
    const [configRes, detailsRes, crewRes] = await Promise.all([
      supabaseAdmin.from('fleet_config').select('*').single(),
      // La tabla puede no existir aún (migración no corrida): el error se ignora y el
      // cliente ve el camión sin patente.
      supabaseAdmin.from('vehicle_details').select('plate').eq('vehicle_id', vehicleId).maybeSingle(),
      supabaseAdmin.from('booking_workers').select('worker_id').eq('booking_id', bookingId),
    ])

    let crewChofers: Array<{ name: string | null }> = []
    const workerIds = ((crewRes.data || []) as Array<{ worker_id: string }>).map((r) => r.worker_id)
    if (workerIds.length > 0) {
      const { data: workers } = await supabaseAdmin
        .from('workers')
        .select('id, name, role')
        .in('id', workerIds)
      crewChofers = ((workers || []) as Array<{ id: string; name: string | null; role: string | null }>)
        .filter((w) => w.role === 'chofer')
        .map((w) => ({ name: w.name }))
    }

    return resolveCustomerAssignment({
      vehicleId,
      vehicles: getFleetVehicles(configRes.data as FleetConfigRow | null),
      plate: ((detailsRes.data || {}) as { plate?: string | null }).plate ?? null,
      crewChofers,
    })
  } catch (error) {
    console.warn('[customerAssignment] No se pudo armar la asignación del cliente:', error)
    return null
  }
}
