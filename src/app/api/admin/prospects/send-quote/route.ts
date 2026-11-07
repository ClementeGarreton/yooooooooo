import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getActorFromRequest, logAdminAction } from '@/lib/activityLog'
import { flowService } from '@/lib/flowService'
import {
  ensureProvisionalBooking,
  createQuoteFlowOrder,
  computeQuoteAmounts,
  SlotUnavailableError,
} from '@/lib/quoteCheckout'
import { n8nConfirmedSuccess } from '@/lib/n8nClient'
import { sendSystemEmail } from '@/lib/emailTransport'
import { quoteStatePhotos } from '@/lib/quoteState'

// Envío de cotización AJUSTADA desde el panel admin:
//  1) toma el prospecto, aplica el precio ajustado + comentario (si vienen)
//  2) garantiza la pre-reserva y actualiza su precio
//  3) genera DOS links de Flow (abono 50% y pago 100% con 5% dcto)
//  4) dispara el webhook de n8n => correo con ambos CTA + comentario de ajuste
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { prospectId } = body as { prospectId?: string }
    const priceInput = body.price
    const commentInput = typeof body.comment === 'string' ? body.comment : undefined
    const dateInput = typeof body.date === 'string' && body.date ? body.date : undefined
    const timeInput = typeof body.time === 'string' && body.time ? body.time : undefined

    if (!prospectId) {
      return NextResponse.json({ error: 'prospectId requerido' }, { status: 400 })
    }

    // 1) Cargar el prospecto
    const { data: prospect, error: findError } = await supabaseAdmin
      .from('quote_prospects')
      .select('*')
      .eq('id', prospectId)
      .maybeSingle()

    if (findError || !prospect) {
      return NextResponse.json({ error: 'Prospecto no encontrado' }, { status: 404 })
    }

    if (!prospect.email || !prospect.name || !prospect.phone) {
      return NextResponse.json(
        { error: 'El prospecto no tiene nombre, email o teléfono completos' },
        { status: 400 }
      )
    }
    const effDate = dateInput || prospect.scheduled_date
    const effTime = timeInput || prospect.scheduled_time
    if (!effDate || !effTime) {
      return NextResponse.json(
        { error: 'Este prospecto no tiene fecha/hora de mudanza. Agrégalas en el modal antes de enviar.' },
        { status: 400 }
      )
    }

    // Precio efectivo: el que envía el admin > el ajustado guardado > el cotizado
    const parsedPrice =
      priceInput === undefined || priceInput === null || priceInput === ''
        ? null
        : Math.round(Number(priceInput))
    const effectivePrice =
      parsedPrice ?? prospect.adjusted_price ?? prospect.total_price

    if (!effectivePrice || effectivePrice <= 0) {
      return NextResponse.json({ error: 'Precio inválido' }, { status: 400 })
    }

    const comment =
      commentInput !== undefined ? commentInput : prospect.adjustment_comment || ''

    const quoteId = prospect.quote_id || `Q-PROS-${prospect.id}`

    const client = {
      name: prospect.name,
      email: prospect.email,
      phone: prospect.phone,
      isCompany: prospect.is_company || false,
      companyName: prospect.company_name,
      companyRut: prospect.company_rut,
    }
    const schedule = { date: effDate, time: effTime }
    const addresses = {
      origin: prospect.origin_address || undefined,
      destination: prospect.destination_address || undefined,
    }
    const propertyDetails = {
      origin: {
        floor: prospect.origin_floor,
        hasElevator: prospect.origin_has_elevator,
        parkingDistance: prospect.origin_parking_distance,
      },
      destination: {
        floor: prospect.destination_floor,
        hasElevator: prospect.destination_has_elevator,
        parkingDistance: prospect.destination_parking_distance,
      },
    }

    // 2) Pre-reserva idempotente + actualizar precio al ajustado
    const { locked } = await ensureProvisionalBooking({
      quoteId,
      client,
      schedule,
      addresses,
      propertyDetails,
      estimatedPrice: effectivePrice,
      paymentType: 'mitad',
      // Las fotos que subió el cliente al cotizar viajan con la reserva.
      photoUrls: quoteStatePhotos(prospect.quote_state),
      stops: prospect.stops,
    })

    // Si la reserva ya fue pagada (locked), NO se toca total_price: antes esta línea lo
    // sobreescribía sin condición, así que reenviar "cotización ajustada" a un cliente que
    // YA pagó borraba el monto realmente cobrado y lo reemplazaba por el precio del modal
    // (bug real: causó que una reserva mostrara un precio distinto al efectivamente pagado).
    if (!locked) {
      await supabaseAdmin
        .from('bookings')
        .update({ total_price: effectivePrice })
        .eq('quote_id', quoteId)
    } else {
      console.warn(`[admin/send-quote] Reserva ${quoteId} ya está pagada: se envía el PDF de referencia sin modificar el precio ni generar nuevos links de pago.`)
    }

    // 3) Dos órdenes de Flow (best-effort): el correo NO debe depender del pago.
    //    Si Flow no está configurado o falla, se envía igual sin links de pago.
    //    Si la reserva ya está pagada (locked), no tiene sentido generar links nuevos —
    //    evita que el cliente pague dos veces por error.
    const amounts = computeQuoteAmounts(effectivePrice)
    let paymentUrl50: string | null = null
    let paymentUrl100: string | null = null
    try {
      if (locked) {
        // no-op: reserva ya pagada, sin links de pago nuevos
      } else if (flowService.isConfigured()) {
        const order50 = await createQuoteFlowOrder({
          quoteId,
          paymentType: 'mitad',
          amount: amounts.abono50,
          email: client.email,
          subject: 'Servicio de Mudanza - Abono 50%',
        })
        const order100 = await createQuoteFlowOrder({
          quoteId,
          paymentType: 'completo',
          amount: amounts.full95,
          email: client.email,
          subject: 'Servicio de Mudanza - Pago 100% (5% dcto)',
        })
        paymentUrl50 = order50.url
        paymentUrl100 = order100.url
      } else {
        console.warn('[admin/send-quote] Flow no configurado: se envía el correo sin links de pago.')
      }
    } catch (flowError) {
      console.error('[admin/send-quote] Flow falló; se envía el correo sin links de pago:', flowError)
    }

    // 4) Payload a n8n (mismo webhook, ahora con ambos links + comentario)
    const payload = {
      event: 'quote_email_adjusted',
      prospect_id: prospect.id,
      quote_id: quoteId,
      cliente: {
        nombre: client.name,
        email: client.email,
        telefono: client.phone || null,
        es_empresa: client.isCompany,
        razon_social: client.isCompany ? client.companyName || null : null,
        rut: client.isCompany ? client.companyRut || null : null,
      },
      cotizacion: {
        origen: prospect.origin_address || null,
        destino: prospect.destination_address || null,
        fecha: prospect.scheduled_date || null,
        hora: prospect.scheduled_time || null,
        distancia_km: prospect.total_distance ?? null,
        volumen_m3: prospect.total_volume ?? null,
        vehiculo: prospect.recommended_vehicle || null,
        precio_total: amounts.estimated,
        precio_50: amounts.abono50,
        precio_100_con_descuento: amounts.full95,
        comentario_ajuste: comment || null,
      },
      pdf_url: prospect.pdf_url || null,
      pago: {
        flow_payment_url: paymentUrl50,
        flow_payment_url_100: paymentUrl100,
        monto: amounts.abono50,
        tipo: 'abono_50',
      },
    }

    const result = await sendSystemEmail(payload, { label: 'ajustada' })
    // No alcanza con el `ok` del HTTP: el webhook responde con `responseMode: responseNode`,
    // así que cuando un nodo del workflow muere a mitad de camino n8n devuelve igual
    // HTTP 200 con el cuerpo VACÍO. Solo `{"success": true}` — que lo emite un nodo
    // posterior al de envío — prueba que el correo salió.
    const enviado = n8nConfirmedSuccess(result)

    // El ajuste se guarda ANTES de saber si el correo salió, y a propósito: para cuando
    // llegamos acá ya se actualizó el precio de la reserva y ya se crearon las órdenes de
    // Flow. Si al fallar el correo no persistiéramos el precio y el comentario, el sistema
    // quedaría a medio camino — reserva con el precio nuevo y prospecto con el viejo — y
    // además se perdería lo que el administrador acaba de escribir en el modal.
    // `quote_sent_at` es lo único que NO se toca sin confirmación: es la marca de "se envió".
    await supabaseAdmin
      .from('quote_prospects')
      .update({
        adjusted_price: parsedPrice ?? prospect.adjusted_price ?? null,
        adjustment_comment: comment || null,
        scheduled_date: effDate,
        scheduled_time: effTime,
        quote_id: quoteId,
        ...(enviado ? { quote_sent_at: new Date().toISOString() } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq('id', prospect.id)

    // Enviada: deja de ser borrador (add_quote_draft.sql) y entra en la secuencia de correos.
    // Aparte y sin revisar el error: sin la migración la columna no existe y no importa.
    if (enviado) await supabaseAdmin.from('quote_prospects').update({ is_draft: false }).eq('id', prospect.id)

    if (!enviado) {
      // El motivo concreto ya quedó logueado en n8nClient (timeout/red/HTTP/sin confirmación).
      return NextResponse.json(
        {
          error:
            'Se guardó el ajuste, pero el correo NO salió. Revisá el workflow de n8n y volvé a enviar.',
        },
        { status: 502 }
      )
    }

    await logAdminAction({
      actor: getActorFromRequest(request),
      action: 'prospect.quote_sent',
      entityType: 'prospect',
      entityId: prospect.id,
      entityLabel: prospect.name || prospect.email || 'Lead',
      summary: `Envió la cotización ${quoteId} por $${Number(effectivePrice).toLocaleString('es-CL')}`,
      changes: { quote_sent: { from: null, to: { quote_id: quoteId, price: effectivePrice } } },
      request,
    })

    return NextResponse.json({
      success: true,
      paymentUrl50,
      paymentUrl100,
      price: effectivePrice,
    })
  } catch (error) {
    if (error instanceof SlotUnavailableError) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    console.error('[admin/send-quote] Error:', error)
    return NextResponse.json(
      {
        error: 'Error al enviar la cotización',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
