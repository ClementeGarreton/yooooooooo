import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getActorFromRequest, logAdminAction } from '@/lib/activityLog'
import { randomBytes } from 'crypto'
import { getDriverPin } from '@/lib/driverSession'
import { effectiveVehiclePin } from '@/lib/driverAccess'
import { getFleetVehicles, type FleetVehicle } from '@/lib/fleetCapacity'

// Gestión de los links del panel de choferes. Protegido por el middleware de admin
// (está bajo /api/admin): el token y el PIN de cada camión SOLO salen por acá.
//
// Hay un link por camión (`vehicles[].accessToken`, muestra solo sus trabajos) y el
// link general heredado (`driver_access_token`, muestra todo). Rotar uno no toca a los
// demás: eso es justamente lo que el link único no permitía.
export const dynamic = 'force-dynamic'

interface VehicleLink {
  id: number
  name: string
  driver: string
  status: string
  color?: string
  /** null = todavía sin link generado. */
  token: string | null
  /** El PIN que hay que darle al chofer (el propio, o el general si no tiene). */
  pin: string
  /** true si el PIN es el general heredado y no uno propio de este camión. */
  usesGeneralPin: boolean
}

function toVehicleLink(v: FleetVehicle, index: number): VehicleLink {
  return {
    id: v.id,
    name: v.name?.trim() || `Camión ${index + 1}`,
    driver: v.driver?.trim() || '',
    status: v.status === 'maintenance' ? 'maintenance' : 'active',
    color: v.color,
    token: typeof v.accessToken === 'string' && v.accessToken ? v.accessToken : null,
    pin: effectiveVehiclePin(v),
    usesGeneralPin: !(typeof v.pin === 'string' && v.pin.trim()),
  }
}

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin.from('fleet_config').select('*').single()

    if (error) {
      console.error('[driver-link] GET error:', error)
      return NextResponse.json({ error: 'Error obteniendo el link' }, { status: 500 })
    }

    const generalToken =
      (data as { driver_access_token?: string | null } | null)?.driver_access_token || null

    return NextResponse.json({
      // `token` y `pin` se mantienen con el nombre viejo por compatibilidad: son el
      // link general heredado.
      token: generalToken,
      pin: getDriverPin(),
      vehicles: getFleetVehicles(data).map(toVehicleLink),
    })
  } catch (error) {
    console.error('Error in /api/admin/driver-link GET:', error)
    return NextResponse.json({ error: 'Error obteniendo el link' }, { status: 500 })
  }
}

/**
 * Genera (o rota) un link.
 *   - `{ vehicleId: 3 }`  → link del camión 3. El anterior de ESE camión deja de servir.
 *   - `{ scope: 'all' }` o body vacío → link general heredado (comportamiento previo).
 */
/**
 * Cambia SOLO la clave de un camión: `{ vehicleId, pin }`.
 *
 * Va por acá y no por /api/admin/fleet-config a propósito. Esa ruta reescribe el array
 * completo de vehículos, y las dos tarjetas (Flota y Acceso Choferes) viven en la misma
 * pantalla: guardar una clave con una copia vieja del array revertiría lo que el admin
 * acabara de editar en la otra. Acá se lee y se escribe solo el campo `pin`.
 *
 * `pin` vacío devuelve el camión al PIN general.
 */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const vehicleId = typeof body?.vehicleId === 'number' ? body.vehicleId : null

    if (vehicleId === null) {
      return NextResponse.json({ error: 'Falta el camión' }, { status: 400 })
    }

    const raw = body?.pin === undefined || body?.pin === null ? '' : String(body.pin).trim()
    if (raw && !/^\d{4,8}$/.test(raw)) {
      return NextResponse.json(
        { error: 'La clave debe tener entre 4 y 8 dígitos' },
        { status: 400 }
      )
    }

    const { data: existing } = await supabaseAdmin.from('fleet_config').select('*').single()
    if (!existing) {
      return NextResponse.json({ error: 'No se encontró configuración de flota' }, { status: 404 })
    }

    const vehicles = getFleetVehicles(existing)
    const index = vehicles.findIndex((v) => v.id === vehicleId)
    if (index === -1) {
      return NextResponse.json({ error: 'Ese camión no existe' }, { status: 404 })
    }

    const updated = vehicles.map((v, i) => (i === index ? { ...v, pin: raw } : v))

    const { error } = await supabaseAdmin
      .from('fleet_config')
      .update({ vehicles: updated, updated_at: new Date().toISOString() })
      .eq('id', existing.id)

    if (error) {
      console.error('[driver-link] PATCH error:', error)
      return NextResponse.json({ error: 'No se pudo guardar la clave' }, { status: 500 })
    }

    const label = vehicles[index].name?.trim() || `Camión ${index + 1}`

    // El log deja constancia del cambio pero NUNCA de la clave en sí.
    await logAdminAction({
      actor: getActorFromRequest(request),
      action: 'driver_link.pin_changed',
      entityType: 'fleet',
      entityId: String(vehicleId),
      entityLabel: label,
      summary: raw
        ? `Cambió la clave del link de ${label}`
        : `Quitó la clave propia de ${label} (vuelve a la clave general)`,
      request,
    })

    return NextResponse.json({
      success: true,
      pin: effectiveVehiclePin({ pin: raw }),
      usesGeneralPin: !raw,
    })
  } catch (error) {
    console.error('Error in /api/admin/driver-link PATCH:', error)
    return NextResponse.json({ error: 'Error guardando la clave' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const vehicleId = typeof body?.vehicleId === 'number' ? body.vehicleId : null

    const { data: existing } = await supabaseAdmin.from('fleet_config').select('*').single()

    if (!existing) {
      return NextResponse.json({ error: 'No se encontró configuración de flota' }, { status: 404 })
    }

    const token = randomBytes(24).toString('base64url')
    const actor = getActorFromRequest(request)

    if (vehicleId === null) {
      const { error } = await supabaseAdmin
        .from('fleet_config')
        .update({ driver_access_token: token, updated_at: new Date().toISOString() })
        .eq('id', existing.id)

      if (error) {
        console.error('[driver-link] POST general error:', error)
        return NextResponse.json(
          {
            error:
              'No se pudo generar el link. ¿Está aplicada la migración add_driver_access_token.sql?',
          },
          { status: 500 }
        )
      }

      await logAdminAction({
        actor,
        action: 'driver_link.regenerated',
        entityType: 'fleet',
        entityLabel: 'Acceso choferes',
        summary: 'Regeneró el link general de choferes (el anterior dejó de funcionar)',
        request,
      })

      return NextResponse.json({ token })
    }

    const vehicles = getFleetVehicles(existing)
    const index = vehicles.findIndex((v) => v.id === vehicleId)

    if (index === -1) {
      return NextResponse.json({ error: 'Ese camión no existe' }, { status: 404 })
    }

    const updated = vehicles.map((v, i) => (i === index ? { ...v, accessToken: token } : v))

    const { error } = await supabaseAdmin
      .from('fleet_config')
      .update({ vehicles: updated, updated_at: new Date().toISOString() })
      .eq('id', existing.id)

    if (error) {
      console.error('[driver-link] POST vehicle error:', error)
      return NextResponse.json({ error: 'No se pudo generar el link del camión' }, { status: 500 })
    }

    const label = vehicles[index].name?.trim() || `Camión ${index + 1}`

    await logAdminAction({
      actor,
      action: 'driver_link.regenerated',
      entityType: 'fleet',
      entityId: String(vehicleId),
      entityLabel: label,
      summary: `Generó el link de choferes de ${label} (el anterior de ese camión dejó de funcionar)`,
      request,
    })

    return NextResponse.json({ token, vehicleId })
  } catch (error) {
    console.error('Error in /api/admin/driver-link POST:', error)
    return NextResponse.json({ error: 'Error generando el link' }, { status: 500 })
  }
}
