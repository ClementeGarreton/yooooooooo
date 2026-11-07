import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import {
  getActorFromRequest,
  logAdminAction,
  statusLabel,
  type FieldChange,
} from '@/lib/activityLog'
import {
  buildCustomerIdentityIndex,
  normalizeCustomerEmail,
  normalizeOrigin,
} from '@/lib/prospectSource'
import { applyItemPackagingPrices, describePriceChanges } from '@/lib/quoteItemPricing'
import { actualPaidAmount, pendingAmount, type BookingLike } from '@/lib/revenueBreakdown'
import { fetchAllRows } from '@/lib/server/fetchAllRows'

/** Etiqueta legible del lead, duplicada en el log para poder leerlo si se borra. */
function prospectLabel(p: { name?: string | null; email?: string | null }) {
  return p?.name || p?.email || 'Lead'
}

export async function GET(request: NextRequest) {
  try {
    // Por defecto solo leads por convertir. Con ?includeConverted=1 también trae los
    // convertidos (para consultarlos desde el panel sin perderlos de vista).
    const includeConverted = new URL(request.url).searchParams.get('includeConverted') === '1'

    // De a páginas: con una sola consulta PostgREST corta en 1.000 filas y los leads más
    // antiguos desaparecían del panel sin ningún error.
    //
    // Los leads y las reservas (para el filtro «Por cobrar», ver abajo) se piden a la vez:
    // no dependen una lectura de la otra, y en fila sumaban las dos esperas.
    const [{ data: prospects, error }, { data: bookings, error: bookingsError }] = await Promise.all([
      fetchAllRows<any>((from, to) =>
        supabaseAdmin
          .from('quote_prospects')
          .select('*')
          .order('created_at', { ascending: false })
          .order('id', { ascending: true })
          .range(from, to)
      ),
      fetchAllRows<any>((from, to) =>
        supabaseAdmin
          .from('bookings')
          .select(
            'id, quote_id, status, payment_status, payment_type, is_provisional, total_price, original_price, adjusted_price, amount_paid'
          )
          .order('created_at', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to)
      ),
    ])

    if (error) {
      console.error('[Admin Prospects] Error fetching:', error)
      return NextResponse.json(
        { error: 'Error obteniendo prospectos', details: error.message },
        { status: 500 }
      )
    }

    // Lo que debe cada lead que ya reservó, para el filtro «Por cobrar». Un lead no tiene
    // pagos propios: la plata vive en su reserva, así que se cruza con ella. Se calcula
    // con `pendingAmount`, la misma cuenta que muestra Reservas en «Falta cobrar», para
    // que las dos pestañas no digan montos distintos de la misma persona.
    //
    // No alcanza con el estado: «Convertido» no significa pagado. Una reserva creada
    // desde el lead sin marcar «ya pagó» también lo deja convertido.
    if (bookingsError) {
      // Sin reservas el panel sigue funcionando; solo el filtro de cobro queda vacío.
      console.error('[Admin Prospects] Error leyendo reservas para el cobro:', bookingsError)
    }
    const bookingById = new Map<string, BookingLike & { id: string; quote_id: string | null }>()
    const bookingByQuote = new Map<string, BookingLike & { id: string; quote_id: string | null }>()
    for (const b of bookings || []) {
      bookingById.set(b.id, b)
      if (b.quote_id) bookingByQuote.set(b.quote_id, b)
    }

    // Las fichas creadas desde Clientes/Reservas comparten la base de contactos,
    // pero no son oportunidades del embudo y no deben reaparecer en Prospectos.
    const allProspects = prospects || []
    const identities = buildCustomerIdentityIndex(allProspects)
    const visibleProspects = allProspects
      .filter((prospect) => {
        const key = String(prospect.lead_key || '')
        const isCustomerRecord =
          key.startsWith('manual_customer:') || key.startsWith('admin_booking:')
        return !isCustomerRecord && (includeConverted || prospect.status !== 'converted')
      })
      .map((prospect) => {
        const identity = identities.get(normalizeCustomerEmail(prospect.email))
        // Primero el vínculo directo (lo escribe la conversión), después el quote_id.
        const booking =
          (prospect.converted_booking_id && bookingById.get(prospect.converted_booking_id)) ||
          (prospect.quote_id && bookingByQuote.get(prospect.quote_id)) ||
          null
        return {
          ...prospect,
          customer_origin: identity?.origin || normalizeOrigin(prospect.source),
          is_existing_customer: Boolean(identity?.isCustomer),
          is_frequent: Boolean(prospect.is_frequent) || Boolean(identity?.isFrequent),
          booking_paid_amount: booking ? actualPaidAmount(booking) : null,
          booking_pending_amount: booking ? pendingAmount(booking) : null,
        }
      })

    return NextResponse.json(visibleProspects)
  } catch (error) {
    console.error('[Admin Prospects] Exception:', error)
    return NextResponse.json({ error: 'Error obteniendo prospectos' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      id,
      status,
      notes,
      source,
      adjusted_price,
      adjustment_comment,
      scheduled_date,
      scheduled_time,
      is_frequent,
      items_summary,
    } = body

    if (!id) {
      return NextResponse.json({ error: 'ID del prospecto requerido' }, { status: 400 })
    }

    const updateData: Record<string, any> = {
      updated_at: new Date().toISOString(),
    }

    if (status !== undefined) updateData.status = status
    if (source !== undefined) updateData.source = source
    if (notes !== undefined) updateData.notes = notes
    if (adjusted_price !== undefined) {
      updateData.adjusted_price =
        adjusted_price === null || adjusted_price === '' ? null : Math.round(Number(adjusted_price))
    }
    if (adjustment_comment !== undefined) updateData.adjustment_comment = adjustment_comment || null
    if (scheduled_date !== undefined) updateData.scheduled_date = scheduled_date || null
    if (scheduled_time !== undefined) updateData.scheduled_time = scheduled_time || null
    if (is_frequent !== undefined) updateData.is_frequent = Boolean(is_frequent)

    // Estado previo para el log (antes → después). `items_summary` además es la
    // base sobre la que se aplican los precios: nunca se escribe lo que mande el
    // cliente tal cual.
    const { data: before } = await supabaseAdmin
      .from('quote_prospects')
      .select('name, email, status, source, adjusted_price, is_frequent, items_summary')
      .eq('id', id)
      .maybeSingle()

    let itemPriceChanges: string[] = []
    if (items_summary !== undefined) {
      if (!before) {
        return NextResponse.json({ error: 'Prospecto no encontrado' }, { status: 404 })
      }
      const applied = applyItemPackagingPrices(before.items_summary, items_summary)
      if (applied.error) {
        return NextResponse.json({ error: applied.error }, { status: 400 })
      }
      itemPriceChanges = describePriceChanges(
        Array.isArray(before.items_summary) ? before.items_summary : [],
        applied.items || []
      )
      updateData.items_summary = applied.items
    }

    const { data, error } = await supabaseAdmin
      .from('quote_prospects')
      .update(updateData)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('[Admin Prospects] Error updating:', error)
      return NextResponse.json({ error: 'Error al actualizar prospecto' }, { status: 500 })
    }

    const actor = getActorFromRequest(request)
    const label = prospectLabel(data || before || {})
    const logBase = {
      actor,
      entityType: 'prospect',
      entityId: id,
      entityLabel: label,
      request,
    }

    if (status !== undefined && before?.status !== data?.status) {
      await logAdminAction({
        ...logBase,
        action: 'prospect.status_changed',
        summary: `Cambió el estado del lead de ${statusLabel(before?.status)} a ${statusLabel(data?.status)}`,
        changes: { status: { from: before?.status, to: data?.status } },
      })
    }

    if (is_frequent !== undefined && before?.is_frequent !== data?.is_frequent) {
      await logAdminAction({
        ...logBase,
        action: 'customer.frequent_toggled',
        summary: data?.is_frequent
          ? 'Marcó al cliente como frecuente'
          : 'Quitó al cliente de frecuentes',
        changes: { is_frequent: { from: before?.is_frequent, to: data?.is_frequent } },
      })
    }

    if (itemPriceChanges.length) {
      await logAdminAction({
        ...logBase,
        action: 'prospect.items_repriced',
        // El detalle completo queda en `changes`; el resumen se corta para que la
        // fila del log siga siendo legible cuando se retocan muchos ítems de golpe.
        summary: `Corrigió el precio de embalaje de ${itemPriceChanges.length} ítem${
          itemPriceChanges.length !== 1 ? 's' : ''
        } de la cotización (${itemPriceChanges.slice(0, 4).join('; ')}${
          itemPriceChanges.length > 4 ? ` y ${itemPriceChanges.length - 4} más` : ''
        })`,
        changes: {
          items_summary: { from: before?.items_summary, to: updateData.items_summary },
        },
      })
    }

    const otherChanges: Record<string, FieldChange> = {}
    if (source !== undefined && before?.source !== data?.source) {
      otherChanges.source = { from: before?.source, to: data?.source }
    }
    if (adjusted_price !== undefined && before?.adjusted_price !== data?.adjusted_price) {
      otherChanges.adjusted_price = { from: before?.adjusted_price, to: data?.adjusted_price }
    }
    if (Object.keys(otherChanges).length) {
      await logAdminAction({
        ...logBase,
        action: 'prospect.updated',
        summary: otherChanges.adjusted_price
          ? `Ajustó el precio del lead a ${data?.adjusted_price ?? '—'}`
          : 'Actualizó datos del lead',
        changes: otherChanges,
      })
    }

    return NextResponse.json({ success: true, prospect: data })
  } catch (error) {
    console.error('[Admin Prospects] Exception updating:', error)
    return NextResponse.json({ error: 'Error al actualizar prospecto' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'ID del prospecto requerido' }, { status: 400 })
    }

    // Se leen los datos ANTES de borrar: es la única copia que quedará en el log.
    const { data: before } = await supabaseAdmin
      .from('quote_prospects')
      .select('name, email, phone, status, source, total_price')
      .eq('id', id)
      .maybeSingle()

    const { error } = await supabaseAdmin.from('quote_prospects').delete().eq('id', id)

    if (error) {
      console.error('[Admin Prospects] Error deleting:', error)
      return NextResponse.json({ error: 'Error al eliminar prospecto' }, { status: 500 })
    }

    await logAdminAction({
      actor: getActorFromRequest(request),
      action: 'prospect.deleted',
      entityType: 'prospect',
      entityId: id,
      entityLabel: prospectLabel(before || {}),
      summary: `Eliminó el lead ${prospectLabel(before || {})}`,
      changes: before ? { deleted_prospect: { from: before, to: null } } : null,
      request,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[Admin Prospects] Exception deleting:', error)
    return NextResponse.json({ error: 'Error al eliminar prospecto' }, { status: 500 })
  }
}
