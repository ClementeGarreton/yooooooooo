import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getActorFromRequest, logAdminAction } from '@/lib/activityLog'
import { normalizeOrigin } from '@/lib/prospectSource'

const normalizeEmail = (value: unknown) =>
  typeof value === 'string' ? value.trim().toLowerCase() : ''

// Crea una ficha de cliente sin crear ni ocupar una reserva. La ficha vive en la
// base de contactos existente y queda fuera del embudo abierto (status=converted).
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    const email = normalizeEmail(body.email)
    const phone = typeof body.phone === 'string' ? body.phone.trim() : ''
    const source = normalizeOrigin(body.source)
    const isCompany = body.is_company === true

    if (!name || !email || !phone) {
      return NextResponse.json(
        { error: 'Nombre, email y teléfono son requeridos' },
        { status: 400 }
      )
    }

    const customerData = {
      name,
      email,
      phone,
      source,
      status: 'converted',
      is_company: isCompany,
      company_name: isCompany && body.company_name ? String(body.company_name).trim() : null,
      company_rut: isCompany && body.company_rut ? String(body.company_rut).trim() : null,
      notes: body.notes ? String(body.notes).trim() : null,
      lead_key: `manual_customer:${email}`,
      updated_at: new Date().toISOString(),
    }

    const { data, error } = await supabaseAdmin
      .from('quote_prospects')
      .upsert(customerData, { onConflict: 'lead_key' })
      .select()
      .single()

    if (error) {
      console.error('[admin/customers] Error creando ficha:', error)
      return NextResponse.json(
        {
          error:
            error.code === '23514'
              ? 'Falta aplicar la migración de origen Cliente antiguo'
              : 'Error al guardar el cliente',
        },
        { status: 500 }
      )
    }

    await logAdminAction({
      actor: getActorFromRequest(request),
      action: 'customer.created',
      entityType: 'prospect',
      entityId: data.id,
      entityLabel: name,
      summary: `Creó una ficha de cliente sin reserva (${source})`,
      changes: { created: { from: null, to: { name, email, phone, source } } },
      request,
    })

    return NextResponse.json({ success: true, customer: data }, { status: 201 })
  } catch (error) {
    console.error('[admin/customers] Exception:', error)
    return NextResponse.json({ error: 'Error al guardar el cliente' }, { status: 500 })
  }
}

// Fija el origen comercial a nivel de cliente. Se guarda como una ficha manual
// prioritaria, de modo que también reclasifica sus reservas históricas por email.
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json()
    const email = normalizeEmail(body.email)
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    const phone = typeof body.phone === 'string' ? body.phone.trim() : ''
    const source = normalizeOrigin(body.source)

    if (!email || !name || !phone) {
      return NextResponse.json(
        { error: 'Nombre, email y teléfono son requeridos' },
        { status: 400 }
      )
    }

    const { data: before } = await supabaseAdmin
      .from('quote_prospects')
      .select('source')
      .eq('lead_key', `manual_customer:${email}`)
      .maybeSingle()

    const { data, error } = await supabaseAdmin
      .from('quote_prospects')
      .upsert(
        {
          name,
          email,
          phone,
          source,
          status: 'converted',
          is_company: body.is_company === true,
          company_name: body.company_name ? String(body.company_name).trim() : null,
          company_rut: body.company_rut ? String(body.company_rut).trim() : null,
          lead_key: `manual_customer:${email}`,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'lead_key' }
      )
      .select('id, source')
      .single()

    if (error) {
      console.error('[admin/customers] Error actualizando origen:', error)
      return NextResponse.json(
        {
          error:
            error.code === '23514'
              ? 'Falta aplicar la migración de origen Cliente antiguo'
              : 'Error al actualizar el origen',
        },
        { status: 500 }
      )
    }

    await logAdminAction({
      actor: getActorFromRequest(request),
      action: 'customer.origin_changed',
      entityType: 'prospect',
      entityId: data.id,
      entityLabel: name,
      summary: `Clasificó al cliente como ${source}`,
      changes: { source: { from: before?.source ?? null, to: source } },
      request,
    })

    return NextResponse.json({ success: true, source })
  } catch (error) {
    console.error('[admin/customers] Exception updating:', error)
    return NextResponse.json({ error: 'Error al actualizar el origen' }, { status: 500 })
  }
}
