import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { flowService } from '@/lib/flowService'
import {
  ensureProvisionalBooking,
  createQuoteFlowOrder,
  computeQuoteAmounts,
  SlotUnavailableError,
} from '@/lib/quoteCheckout'
import { resolveBookingAttribution } from '@/lib/attributionServer'
import { n8nConfirmedSuccess } from '@/lib/n8nClient'
import { sendSystemEmail } from '@/lib/emailTransport'
import { webQuotePriceProblem } from '@/lib/server/webQuotePrice'

// Envío REAL de la cotización por correo:
//  1) garantiza la pre-reserva (sin consumir cupo)
//  2) genera el link de pago de Flow (abono 50%)
//  3) hace POST a n8n con todo el payload (PDF + link de pago) => n8n manda el correo
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { quoteId, prospectId, schedule, addresses, propertyDetails, details, photoUrls, stops } = body

    if (!quoteId || !UUID_RE.test(String(prospectId || ''))) {
      return NextResponse.json({ error: 'No pudimos guardar tu cotización. Vuelve a intentarlo.' }, { status: 400 })
    }

    // Destinatario, nombre, precio y PDF salen de la cotización guardada, no del cuerpo: antes
    // esta ruta mandaba desde nuestro dominio un correo con lo que le enviaran, a cualquiera.
    const { data: prospect, error: prospectError } = await supabaseAdmin
      .from('quote_prospects')
      .select('id, quote_id, name, email, total_price, pdf_url, quote_state')
      .eq('id', prospectId)
      .maybeSingle()
    if (prospectError) throw prospectError
    if (!prospect?.email || !prospect.name || !prospect.total_price) {
      return NextResponse.json({ error: 'No encontramos tu cotización. Vuelve a intentarlo.' }, { status: 404 })
    }
    if (prospect.quote_id && prospect.quote_id !== quoteId) {
      return NextResponse.json({ error: 'Esta cotización cambió. Vuelve al resumen e inténtalo de nuevo.' }, { status: 409 })
    }
    const client = { ...(body.client || {}), name: prospect.name, email: prospect.email }
    const estimatedPrice = Number(prospect.total_price)

    // El precio guardado también lo calculó el navegador, y de acá sale el link de pago.
    const problemaPrecio = await webQuotePriceProblem('send-quote', quoteId, estimatedPrice, prospect.quote_state)
    if (problemaPrecio) return NextResponse.json({ error: problemaPrecio }, { status: 409 })

    if (!prospect.quote_id) {
      const { error: linkError } = await supabaseAdmin
        .from('quote_prospects')
        .update({
          quote_id: quoteId,
          updated_at: new Date().toISOString(),
        })
        .eq('id', prospectId)

      if (linkError) {
        console.error('[send-quote] Error vinculando prospecto con quote_id:', linkError)
      }
    }

    // 1) Pre-reserva idempotente (no consume cupo hasta que se pague)
    const attribution = await resolveBookingAttribution(body, quoteId)
    const { locked } = await ensureProvisionalBooking({
      quoteId,
      client,
      schedule,
      addresses,
      propertyDetails,
      estimatedPrice,
      paymentType: 'mitad',
      photoUrls,
      stops,
      attribution,
      // La casilla del envío por correo incluye las Políticas de Garantía: el cliente
      // puede reservar pagando desde el enlace del correo sin volver a la página.
      policiesAccepted: body?.policiesAccepted === true,
    })

    // 2) Link de pago de Flow (best-effort): el correo con el PDF NO debe depender
    //    del pago. Si Flow no está configurado o falla, igual se envía el correo,
    //    solo que sin link de pago (flow_payment_url = null). Si ya está pagada, tampoco
    //    se genera un link nuevo — evita que el cliente pague dos veces por error.
    const amounts = computeQuoteAmounts(estimatedPrice)
    let paymentUrl: string | null = null
    try {
      if (locked) {
        console.warn(`[send-quote] Reserva ${quoteId} ya está pagada: se envía el correo sin link de pago.`)
      } else if (flowService.isConfigured()) {
        const order = await createQuoteFlowOrder({
          quoteId,
          paymentType: 'mitad',
          amount: amounts.abono50,
          email: client.email,
          subject: 'Servicio de Mudanza - Abono 50%',
        })
        paymentUrl = order.url
      } else {
        console.warn('[send-quote] Flow no configurado: se envía el correo sin link de pago.')
      }
    } catch (flowError) {
      console.error('[send-quote] Flow falló; se envía el correo sin link de pago:', flowError)
    }

    // 3) El PDF guardado en la cotización.
    const pdfUrl: string | null = prospect.pdf_url || null

    // Payload para n8n
    const payload = {
      event: 'quote_email_requested',
      prospect_id: prospectId,
      quote_id: quoteId,
      cliente: {
        nombre: client.name,
        email: client.email,
        telefono: client.phone || null,
        es_empresa: client.isCompany || false,
        razon_social: client.isCompany ? client.companyName || null : null,
        rut: client.isCompany ? client.companyRut || null : null,
      },
      cotizacion: {
        origen: addresses?.origin || null,
        destino: addresses?.destination || null,
        fecha: schedule?.date || null,
        hora: schedule?.time || null,
        distancia_km: details?.distanceKm ?? null,
        // Redondeo a 2 decimales para evitar "1.4500000000000002" en el correo
        volumen_m3:
          details?.volumeM3 != null ? Math.round(details.volumeM3 * 100) / 100 : null,
        vehiculo: details?.vehicle || null,
        precio_total: amounts.estimated,
        precio_50: amounts.abono50,
        precio_100_con_descuento: amounts.full95,
        es_flexible: details?.isFlexible || false,
      },
      pdf_url: pdfUrl,
      pago: {
        flow_payment_url: paymentUrl,
        monto: amounts.abono50,
        tipo: 'abono_50',
      },
    }

    const result = await sendSystemEmail(payload, { label: 'cliente' })

    // No alcanza con `result.ok`: el webhook usa `responseMode: responseNode`, así que
    // si un nodo del workflow muere a mitad de camino n8n contesta HTTP 200 con el
    // cuerpo VACÍO y el correo nunca salió. La única señal de que el envío se completó
    // es el `{"success": true}` del nodo `Respond to Webhook`, que solo corre después
    // del nodo de envío. Sin esto le decimos "cotización enviada" a alguien que no
    // recibió nada.
    if (!n8nConfirmedSuccess(result)) {
      // El motivo concreto ya quedó logueado en n8nClient (timeout/red/HTTP/sin confirmación).
      return NextResponse.json(
        { error: 'No se pudo enviar la cotización por correo. Intenta de nuevo.' },
        { status: 502 }
      )
    }

    // Marca de «ya se le mandó la cotización». Solo con envío confirmado, igual que en el
    // panel: la usa el cron para no mandar el #01 automático encima de este correo.
    const { error: marcaError } = await supabaseAdmin
      .from('quote_prospects')
      .update({ quote_sent_at: new Date().toISOString() })
      .eq('id', prospectId)
    if (marcaError) console.error('[send-quote] No se pudo marcar quote_sent_at:', marcaError)

    return NextResponse.json({ success: true, paymentUrl })
  } catch (error) {
    if (error instanceof SlotUnavailableError) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    console.error('[send-quote] Error:', error)
    return NextResponse.json(
      { error: 'Error al enviar la cotización' },
      { status: 500 }
    )
  }
}
