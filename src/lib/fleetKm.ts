/**
 * Kilometraje de cada camión.
 *
 * Dos números distintos, y conviene no confundirlos:
 *  - La LECTURA: lo que marca el tablero, cargado a mano con su fecha. Es el dato real.
 *  - El ESTIMADO: esa lectura más los kilómetros de los trabajos que el camión hizo desde
 *    entonces. Sirve para ver el desgaste entre una lectura y la siguiente.
 *
 * El estimado QUEDA CORTO, y la pantalla lo dice:
 *  - La distancia de un trabajo es la del cotizador (origen → destino). No incluye ir desde
 *    la base al origen, volver, ni las paradas.
 *  - Solo la tienen las reservas que nacieron de una cotización con ruta calculada. Las
 *    cargadas a mano en el panel no tienen distancia y no suman. Por eso se muestra cuántos
 *    trabajos tiene el camión y cuántos de ellos aportaron kilómetros.
 * Cargar una lectura nueva corrige todo: el estimado vuelve a partir de ahí.
 */

import { supabaseAdmin } from '@/lib/supabase'
import { getFleetVehicles } from '@/lib/fleetCapacity'
import type { VehicleKm } from '@/lib/fleetKmTypes'

export class FleetKmError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message)
    this.name = 'FleetKmError'
  }
}

/** 42P01 / PGRST205 = falta correr add_vehicle_details.sql. */
export function isMissingVehicleDetails(error: { code?: string } | null | undefined): boolean {
  return error?.code === '42P01' || error?.code === 'PGRST205'
}

const chileToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date())

export async function getFleetKm(): Promise<{ available: boolean; vehicles: VehicleKm[] }> {
  const today = chileToday()
  const [{ data: config }, detailsResult, { data: bookings }] = await Promise.all([
    supabaseAdmin.from('fleet_config').select('*').single(),
    supabaseAdmin.from('vehicle_details').select('vehicle_id, plate, brand, odometer_km, odometer_at'),
    // Trabajos ya ocurridos (hasta hoy) con camión asignado.
    supabaseAdmin
      .from('bookings')
      .select('quote_id, vehicle_id, scheduled_date, is_provisional')
      .not('vehicle_id', 'is', null)
      .lte('scheduled_date', today)
      .not('status', 'in', '(cancelled,no_show)'),
  ])
  const available = !isMissingVehicleDetails(detailsResult.error)
  if (detailsResult.error && available) throw detailsResult.error

  const jobs = (bookings || []).filter((b: any) => !b.is_provisional && !String(b.quote_id || '').startsWith('ADMIN-BLOQUEO-'))
  const quoteIds = Array.from(new Set(jobs.map((b: any) => b.quote_id).filter(Boolean)))
  const distance = new Map<string, number>()
  // De a tandas: son cientos de ids y van en la URL de la consulta.
  for (let i = 0; i < quoteIds.length; i += 150) {
    const { data } = await supabaseAdmin.from('quote_prospects').select('quote_id, total_distance').in('quote_id', quoteIds.slice(i, i + 150))
    for (const p of data || []) {
      const km = Number(p.total_distance)
      // Una cotización puede tener varias filas: se toma la mayor distancia válida.
      if (p.quote_id && km > 0) distance.set(p.quote_id, Math.max(distance.get(p.quote_id) || 0, km))
    }
  }

  const details = new Map((detailsResult.data || []).map((d: any) => [d.vehicle_id, d]))
  const vehicles: VehicleKm[] = getFleetVehicles(config).map((v, i) => {
    const d: any = details.get(v.id)
    const since: string | null = d?.odometer_at || null
    // Con lectura: solo los trabajos POSTERIORES al día de la lectura (ese día ya está en ella).
    const own = jobs.filter((b: any) => b.vehicle_id === v.id && (!since || b.scheduled_date > since))
    const withDistance = own.filter((b: any) => distance.has(b.quote_id))
    const jobsKm = Math.round(withDistance.reduce((sum: number, b: any) => sum + (distance.get(b.quote_id) || 0), 0))
    const odometerKm = typeof d?.odometer_km === 'number' ? d.odometer_km : null
    return {
      vehicleId: v.id,
      name: v.name?.trim() || `Camión ${i + 1}`,
      driver: v.driver?.trim() || '',
      status: v.status === 'maintenance' ? 'maintenance' : 'active',
      plate: d?.plate || null,
      brand: d?.brand || null,
      odometerKm,
      odometerAt: since,
      jobsCount: own.length,
      jobsWithDistance: withDistance.length,
      jobsKm,
      estimatedKm: odometerKm !== null ? odometerKm + jobsKm : null,
    }
  })
  return { available, vehicles }
}

const text = (value: unknown, max: number) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null)

/**
 * Guarda la ficha de un camión. Body: cualquiera de `{ plate, brand, odometerKm }`. Una
 * lectura de kilometraje nueva queda con la fecha de hoy: desde ahí vuelve a contar el
 * estimado. Si la lectura no cambia, su fecha tampoco.
 */
export async function saveVehicleDetails(rawVehicleId: unknown, body: any, actor: string) {
  const vehicleId = Number(rawVehicleId)
  if (!Number.isInteger(vehicleId)) throw new FleetKmError('Camión inválido', 404)
  const { data: config } = await supabaseAdmin.from('fleet_config').select('*').single()
  const vehicle = getFleetVehicles(config).find((v) => v.id === vehicleId)
  if (!vehicle) throw new FleetKmError('Ese camión no existe en la flota', 404)

  const { data: before, error: readError } = await supabaseAdmin.from('vehicle_details').select('*').eq('vehicle_id', vehicleId).maybeSingle()
  if (readError) {
    if (isMissingVehicleDetails(readError)) throw new FleetKmError('Falta correr la migración add_vehicle_details.sql.', 503)
    throw readError
  }

  const next: Record<string, unknown> = {
    vehicle_id: vehicleId,
    plate: body?.plate !== undefined ? text(body.plate, 12)?.toUpperCase() || null : before?.plate ?? null,
    brand: body?.brand !== undefined ? text(body.brand, 80) : before?.brand ?? null,
    odometer_km: before?.odometer_km ?? null,
    odometer_at: before?.odometer_at ?? null,
    updated_by: actor,
    updated_at: new Date().toISOString(),
  }
  if (body?.odometerKm !== undefined && body.odometerKm !== null && body.odometerKm !== '') {
    const km = Math.round(Number(body.odometerKm))
    if (!Number.isFinite(km) || km < 0 || km > 3_000_000) throw new FleetKmError('El kilometraje no es válido.')
    if (km !== before?.odometer_km) {
      next.odometer_km = km
      next.odometer_at = chileToday()
    }
  }

  const { error } = await supabaseAdmin.from('vehicle_details').upsert(next, { onConflict: 'vehicle_id' })
  if (error) throw error
  return { vehicleName: vehicle.name?.trim() || `Camión ${vehicleId}`, before: before || null, after: next }
}
