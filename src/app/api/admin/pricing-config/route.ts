import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getActorFromRequest, logAdminAction } from '@/lib/activityLog'
import { hasAdminAction } from '@/lib/adminPermissions'
import {
  readPricingConfig,
  withCrewDefaults,
  withServiceDefaults,
  withStairsDefaults,
} from '@/lib/server/pricingConfigServer'

// Las normalizaciones y la lectura viven en `server/pricingConfigServer.ts`: el endpoint
// de cotización necesita exactamente la misma configuración y no puede pedírsela a esta
// ruta por HTTP. Acá queda el contrato HTTP (GET para el cotizador público, PUT para el
// panel) y nada de la lógica.

export async function GET() {
  try {
    const config = await readPricingConfig()
    return NextResponse.json(config)
  } catch (error) {
    console.error('Error in /api/admin/pricing-config:', error)
    return NextResponse.json(
      { error: 'Error obteniendo configuración de precios' },
      { status: 500 }
    )
  }
}

export async function PUT(request: NextRequest) {
  // Precios en solo lectura para quien no tiene «Cambiar precios» (Tomás, 21-10-2026).
  if (!(await hasAdminAction(request, 'pricing.edit'))) {
    return NextResponse.json({ error: 'Tu perfil puede ver los precios, pero no cambiarlos.' }, { status: 403 })
  }
  try {
    const body = await request.json()

    // Validar que todos los campos requeridos estén presentes
    const requiredFields = [
      'basePrice', 'pricePerCubicMeter', 'pricePerKilometer', 'floorSurcharge',
      'additionalServices', 'specialPackaging', 'timeSurcharges', 'discounts'
    ]

    for (const field of requiredFields) {
      if (!(field in body)) {
        return NextResponse.json(
          { error: `Campo requerido faltante: ${field}` },
          { status: 400 }
        )
      }
    }

    // Transformar los datos del frontend al formato de la BD
    const dbData = {
      base_price: body.basePrice,
      price_per_cubic_meter: body.pricePerCubicMeter,
      price_per_kilometer: body.pricePerKilometer,
      free_kilometers: body.freeKilometers || 50,
      floor_surcharge: body.floorSurcharge,
      additional_services: withServiceDefaults(body.additionalServices),
      special_packaging: body.specialPackaging,
      time_surcharges: body.timeSurcharges,
      discounts: body.discounts,
      crew_config: withCrewDefaults(body.crew),
      stairs_config: withStairsDefaults(body.stairs),
      updated_at: new Date().toISOString()
    }

    // Verificar si ya existe configuración
    const { data: existingConfig } = await supabaseAdmin
      .from('pricing_config')
      .select('id')
      .single()

    let result
    if (existingConfig) {
      // Actualizar configuración existente
      result = await supabaseAdmin
        .from('pricing_config')
        .update(dbData)
        .eq('id', existingConfig.id)
        .select()
        .single()
    } else {
      // Crear nueva configuración
      result = await supabaseAdmin
        .from('pricing_config')
        .insert({
          ...dbData,
          created_at: new Date().toISOString()
        })
        .select()
        .single()
    }

    if (result.error) {
      console.error('Error saving pricing config:', result.error)
      return NextResponse.json(
        { error: 'Error guardando configuración de precios' },
        { status: 500 }
      )
    }

    await logAdminAction({
      actor: getActorFromRequest(request),
      action: 'pricing.updated',
      entityType: 'pricing',
      entityId: result.data?.id ? String(result.data.id) : null,
      entityLabel: 'Configuración de precios',
      summary: `Actualizó los precios (base $${Number(body.basePrice || 0).toLocaleString('es-CL')}, m³ $${Number(body.pricePerCubicMeter || 0).toLocaleString('es-CL')}, km $${Number(body.pricePerKilometer || 0).toLocaleString('es-CL')})`,
      // Se guarda la configuración completa: es el cambio que más impacta la facturación.
      changes: { pricing: { from: existingConfig ? 'anterior' : null, to: dbData } },
      request,
    })

    return NextResponse.json({
      success: true,
      message: 'Configuración de precios guardada exitosamente',
      data: result.data
    })
  } catch (error) {
    console.error('Error in /api/admin/pricing-config PUT:', error)
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    )
  }
}
