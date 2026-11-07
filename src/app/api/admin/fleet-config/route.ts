import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getActorFromRequest, logAdminAction } from '@/lib/activityLog'
import { resolveVehicleColor, vehicleColorByKey } from '@/lib/vehicleColors'
import { getFleetVehicles, type FleetVehicle } from '@/lib/fleetCapacity'

/** Medidas: número no negativo o 0. Nunca null, para que el formulario no muestre vacíos. */
function positiveNumber(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/**
 * PIN del camión: 4 a 8 dígitos, o vacío para volver al PIN general.
 * Se rechaza cualquier otra cosa en vez de "arreglarla" — un PIN silenciosamente
 * distinto del que el admin escribió deja al chofer afuera sin que nadie se entere.
 */
function sanitizeVehiclePin(value: unknown): { ok: true; pin: string } | { ok: false; error: string } {
  if (value === undefined || value === null) return { ok: true, pin: '' }
  const pin = String(value).trim()
  if (!pin) return { ok: true, pin: '' }
  if (!/^\d{4,8}$/.test(pin)) {
    return { ok: false, error: 'La clave de cada camión debe tener entre 4 y 8 dígitos' }
  }
  return { ok: true, pin }
}

export async function GET() {
  try {
    // Obtener configuración de flota
    const { data: config, error } = await supabaseAdmin
      .from('fleet_config')
      .select('*')
      .single()

    if (error) {
      console.error('Error fetching fleet config:', error)
      return NextResponse.json(
        { error: 'Error obteniendo configuración de flota' },
        { status: 500 }
      )
    }

    return NextResponse.json(config)
  } catch (error) {
    console.error('Error in /api/admin/fleet-config:', error)
    return NextResponse.json(
      { error: 'Error obteniendo configuración de flota' },
      { status: 500 }
    )
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json()
    const { num_vehicles, vehicles } = body

    // Se lee la fila completa (no solo el id) porque el sanitizador necesita los
    // vehículos actuales para conservar su `accessToken`.
    const { data: existingConfig } = await supabaseAdmin
      .from('fleet_config')
      .select('*')
      .single()

    if (!existingConfig) {
      return NextResponse.json(
        { error: 'No se encontró configuración de flota' },
        { status: 404 }
      )
    }

    // Token del link de cada camión, indexado por id. NO se toma nunca del body: el
    // único que puede crearlo o rotarlo es /api/admin/driver-link. Si viniera del
    // cliente, guardar la flota con un formulario viejo borraría links en uso.
    const previousTokens = new Map<number, string>()
    const previousPins = new Map<number, string>()
    for (const v of getFleetVehicles(existingConfig) as FleetVehicle[]) {
      if (typeof v?.accessToken === 'string' && v.accessToken) {
        previousTokens.set(v.id, v.accessToken)
      }
      if (typeof v?.pin === 'string' && v.pin) {
        previousPins.set(v.id, v.pin)
      }
    }

    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString()
    }

    if (Array.isArray(vehicles)) {
      // El PIN se valida antes de escribir nada: si uno solo está mal, no se guarda
      // la flota a medias.
      for (const v of vehicles) {
        if (!(v && typeof v === 'object' && 'pin' in v)) continue
        const check = sanitizeVehiclePin(v.pin)
        if (!check.ok) {
          return NextResponse.json({ error: check.error }, { status: 400 })
        }
      }

      // Persistir la lista de vehículos con su estado (activo/mantenimiento) y su color.
      const sanitized = vehicles.map((v, i) => ({
        id: typeof v?.id === 'number' ? v.id : i + 1,
        name:
          typeof v?.name === 'string' && v.name.trim()
            ? v.name.trim()
            : `Camión ${i + 1}`,
        capacity:
          typeof v?.capacity === 'number' && v.capacity > 0 ? v.capacity : 1,
        driver: typeof v?.driver === 'string' ? v.driver : '',
        phone: typeof v?.phone === 'string' ? v.phone : '',
        status: v?.status === 'maintenance' ? 'maintenance' : 'active',
        // El color solo se guarda si es una clave conocida de la paleta; cualquier otra
        // cosa se descarta y el color se deriva de la posición al leerlo.
        color: vehicleColorByKey(v?.color)?.key ?? resolveVehicleColor(v, i).key,
        // Dimensiones en metros y carga máxima en kilos. 0 = sin medir.
        length: positiveNumber(v?.length),
        width: positiveNumber(v?.width),
        height: positiveNumber(v?.height),
        maxWeight: positiveNumber(v?.maxWeight),
        // Clave del link de este camión. Vacía = usa el PIN general.
        //
        // Solo se cambia si el body TRAE la propiedad. Un cliente que guarde la flota
        // sin mandar `pin` (una pestaña vieja, otra pantalla del panel) conserva la que
        // ya estaba, en vez de dejar al chofer con una clave que nadie cambió.
        pin:
          v && typeof v === 'object' && 'pin' in v
            ? (sanitizeVehiclePin(v.pin) as { ok: true; pin: string }).pin
            : previousPins.get(typeof v?.id === 'number' ? v.id : i + 1) ?? '',
        // Se conserva el token que ya tenía; el body no puede fijarlo.
        accessToken: previousTokens.get(typeof v?.id === 'number' ? v.id : i + 1) ?? ''
      }))

      if (sanitized.length < 1) {
        return NextResponse.json(
          { error: 'Debe haber al menos 1 vehículo' },
          { status: 400 }
        )
      }

      updates.vehicles = sanitized
      // num_vehicles refleja el total de vehículos (activos + en mantenimiento).
      updates.num_vehicles = sanitized.length
    } else if (num_vehicles !== undefined) {
      if (!num_vehicles || num_vehicles < 1) {
        return NextResponse.json(
          { error: 'Número de vehículos debe ser mayor a 0' },
          { status: 400 }
        )
      }
      updates.num_vehicles = num_vehicles
    } else {
      return NextResponse.json(
        { error: 'Nada que actualizar' },
        { status: 400 }
      )
    }

    // Actualizar configuración de flota
    const { data: config, error } = await supabaseAdmin
      .from('fleet_config')
      .update(updates)
      .eq('id', existingConfig.id)
      .select()
      .single()

    if (error) {
      console.error('Error updating fleet config:', error)
      return NextResponse.json(
        { error: 'Error al actualizar la configuración de flota' },
        { status: 500 }
      )
    }

    // El detalle que importa: cuántos camiones quedan operativos, porque define los
    // cupos que el cotizador ofrece al público.
    const activos = Array.isArray(config?.vehicles)
      ? config.vehicles.filter((v: any) => v?.status === 'active').length
      : config?.num_vehicles ?? 0
    const enMantenimiento = Array.isArray(config?.vehicles)
      ? config.vehicles.filter((v: any) => v?.status === 'maintenance').length
      : 0

    await logAdminAction({
      actor: getActorFromRequest(request),
      action: 'fleet.updated',
      entityType: 'fleet',
      entityId: config?.id ? String(config.id) : null,
      entityLabel: 'Flota',
      summary: `Actualizó la flota: ${activos} camión(es) activo(s)` +
        (enMantenimiento ? `, ${enMantenimiento} en mantenimiento` : ''),
      changes: { vehicles: { from: null, to: updates.vehicles ?? updates.num_vehicles ?? null } },
      request,
    })

    return NextResponse.json({
      success: true,
      config,
      message: 'Configuración de flota actualizada correctamente'
    })
  } catch (error) {
    console.error('Error in /api/admin/fleet-config PATCH:', error)
    return NextResponse.json(
      { error: 'Error al actualizar la configuración de flota' },
      { status: 500 }
    )
  }
}