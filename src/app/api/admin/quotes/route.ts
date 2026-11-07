import { NextRequest, NextResponse } from 'next/server'
import { getActorFromRequest, logAdminAction } from '@/lib/activityLog'
import { supabaseAdmin } from '@/lib/supabase'
import { QuoteProspectInputError, upsertQuoteProspect } from '@/lib/server/quoteProspects'

/**
 * COTIZACIÓN CARGADA DESDE EL PANEL.
 *
 * La secretaria usa los mismos pasos del cotizador web y llega con el precio calculado;
 * acá se guarda la cotización con ese cálculo y, si lo cambió, con el precio final que
 * acordó con el cliente. Todo en UNA escritura a propósito: si el ajuste fuera un segundo
 * paso y fallara, el prospecto quedaría con el precio calculado y el cron de seguimiento
 * (que corre cada hora) podría mandarle al cliente un correo con el precio equivocado.
 *
 * Qué queda guardado y dónde:
 *  - `total_price`     → precio calculado por el sistema.
 *  - `adjusted_price`  → precio final, solo si difiere del calculado.
 *  - el log de actividad → quién lo cambió, de cuánto a cuánto y por qué. Es la
 *    trazabilidad que no se pierde aunque el prospecto se vuelva a editar.
 *
 * No envía nada: el PDF se sube y la cotización se manda por las rutas de siempre
 * (`/api/prospects/upload-pdf` y `/api/admin/prospects/send-quote`), que ya leen el precio
 * final del prospecto guardado.
 *
 * Desde el 20-10-2026:
 *  - `draft: true` = «Guardar sin enviar»: queda como borrador (`is_draft`) y no recibe
 *    los correos automáticos de cotización hasta que se envíe.
 *  - `prospect_id` = se está EDITANDO esa cotización (p. ej. sus artículos): se actualiza
 *    esa misma fila, venga del panel o de la web.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const quote = (body?.quote || {}) as Record<string, any>

    const calculated = Math.round(Number(quote.total_price))
    if (!Number.isFinite(calculated) || calculated <= 0) {
      return NextResponse.json(
        { error: 'La cotización no tiene un precio calculado. Vuelve al resumen y espera el cálculo.' },
        { status: 400 }
      )
    }

    const rawFinal = body?.final_price
    const final = Math.round(Number(rawFinal))
    if (rawFinal === undefined || rawFinal === null || rawFinal === '' || !Number.isFinite(final) || final <= 0) {
      return NextResponse.json({ error: 'El precio final debe ser un monto mayor que cero' }, { status: 400 })
    }

    // Sin fecha y hora la cotización no se puede enviar (el envío crea la pre-reserva y los
    // links de pago): mejor frenarla acá que guardarla a medias.
    if (!quote.scheduled_date || !quote.scheduled_time) {
      return NextResponse.json({ error: 'Falta la fecha u hora de la mudanza' }, { status: 400 })
    }

    const adjusted = final !== calculated
    const comment =
      typeof body?.adjustment_comment === 'string' && body.adjustment_comment.trim()
        ? body.adjustment_comment.trim()
        : null

    // La atribución de Google Ads se descarta aunque venga: en el panel sería la cookie de
    // la secretaria, no un clic del cliente.
    const { attribution: _ignorada, ...sinAtribucion } = quote

    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    const prospectId = typeof body?.prospect_id === 'string' && UUID_RE.test(body.prospect_id) ? body.prospect_id : undefined
    const draft = body?.draft === true
    if (draft) {
      const { error: draftColumn } = await supabaseAdmin.from('quote_prospects').select('is_draft').limit(1)
      if (draftColumn) return NextResponse.json({ error: 'Para guardar sin enviar falta correr la migración add_quote_draft.sql.' }, { status: 409 })
    }
    if (prospectId) {
      const { data: existing } = await supabaseAdmin.from('quote_prospects').select('id').eq('id', prospectId).maybeSingle()
      if (!existing) return NextResponse.json({ error: 'Esa cotización ya no existe.' }, { status: 404 })
    }

    const { prospect } = await upsertQuoteProspect(
      sinAtribucion,
      {
        adjusted_price: adjusted ? final : null,
        adjustment_comment: adjusted ? comment : null,
      },
      { prospectId }
    )
    // Guardada sin enviar: borrador, sin correos automáticos hasta que se envíe.
    if (draft) await supabaseAdmin.from('quote_prospects').update({ is_draft: true }).eq('id', prospect.id)

    await logAdminAction({
      actor: getActorFromRequest(request),
      action: prospectId ? 'prospect.admin_quote_edited' : draft ? 'prospect.admin_quote_saved' : 'prospect.admin_quote_created',
      entityType: 'prospect',
      entityId: prospect.id,
      entityLabel: prospect.name || prospect.email || 'Lead',
      summary: (prospectId ? 'Editó la cotización: ' : draft ? 'Guardó sin enviar: ' : '') + (adjusted
        ? `Cotizó desde el panel: calculado $${calculated.toLocaleString('es-CL')}, final $${final.toLocaleString('es-CL')} (${final > calculated ? '+' : '−'}$${Math.abs(final - calculated).toLocaleString('es-CL')})`
        : `Cotizó desde el panel por $${final.toLocaleString('es-CL')} (sin ajuste)`),
      changes: {
        quote: {
          from: null,
          to: {
            quote_id: prospect.quote_id,
            calculated_price: calculated,
            final_price: final,
            adjusted,
            adjustment_comment: adjusted ? comment : null,
          },
        },
      },
      request,
    })

    return NextResponse.json(
      {
        success: true,
        prospectId: prospect.id,
        quoteId: prospect.quote_id,
        calculatedPrice: calculated,
        finalPrice: final,
        adjusted,
      },
      { status: 201 }
    )
  } catch (error) {
    if (error instanceof QuoteProspectInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    console.error('[admin/quotes] Error:', error)
    return NextResponse.json({ error: 'No se pudo guardar la cotización' }, { status: 500 })
  }
}
