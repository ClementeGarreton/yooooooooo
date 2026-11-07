import { supabaseAdmin } from '@/lib/supabase'
import { flowService, type FlowPaymentStatus } from '@/lib/flowService'
import { sendSystemEmail } from '@/lib/emailTransport'
import { sendBookingConfirmed } from '@/lib/transactionalEmails'
import { recordPayment, type PaymentKind } from '@/lib/bookingPayments'

/**
 * Datos mínimos de la reserva que necesitan los endpoints de pago para redirigir
 * al usuario (página de éxito online vs domicilio) y para convertir el prospecto.
 */
export interface SyncedBookingData {
  id: string
  booking_type?: string | null
  client_name?: string | null
  client_email?: string | null
  visit_address?: string | null
  payment_status?: string | null
  amount_paid?: number | null
}

export interface ApplyFlowPaymentResult {
  paymentStatus: FlowPaymentStatus
  /** La reserva (datos previos al update). null si no se encontró por quote_id. */
  bookingData: SyncedBookingData | null
  /** quote_id estable con el que se resolvió la reserva. */
  bookingRef: string
  /** true si la reserva ya estaba aprobada antes de este token (no se re-procesó el prospecto). */
  alreadyProcessed: boolean
}

/**
 * Fuente ÚNICA de verdad para aplicar el resultado de un pago de Flow a la reserva.
 *
 * La usan por igual el webhook server-to-server (`/api/payment/confirm`) y el retorno del
 * navegador (`/api/payment/result`), de modo que ambos hagan EXACTAMENTE lo mismo.
 *
 * Resuelve la reserva por `optional.bookingId` (el quote_id estable) con fallback al
 * `commerceOrder`. Esto corrige el bug donde `result` buscaba por `commerceOrder`
 * (`Q-123-mitad-1718...`) y nunca encontraba la reserva (`quote_id = Q-123`), dejándola
 * "pendiente" si el webhook tardaba o fallaba.
 *
 * Idempotente: si la reserva ya estaba `payment_status='approved'`, el UPDATE es inofensivo
 * y la conversión del prospecto (con efectos colaterales) NO se repite.
 */
export async function applyFlowPaymentByToken(
  token: string
): Promise<ApplyFlowPaymentResult> {
  const paymentStatus = await flowService.getPaymentStatus(token)
  return applyFlowPaymentStatus(paymentStatus, token)
}

/**
 * Igual que `applyFlowPaymentByToken` pero resolviendo el pago por su `commerceOrder`
 * (sin token). Lo usa el cron de limpieza como red de seguridad: cuando encuentra una
 * pre-reserva provisional que en realidad tiene un pago aprobado en Flow, la rescata
 * aplicando exactamente la misma lógica que el webhook, sin necesitar el token original.
 */
export async function applyFlowPaymentByCommerceOrder(
  commerceOrder: string
): Promise<ApplyFlowPaymentResult> {
  const paymentStatus = await flowService.getStatusByCommerceId(commerceOrder)
  return applyFlowPaymentStatus(paymentStatus, null)
}

/**
 * Núcleo compartido: aplica un `FlowPaymentStatus` ya obtenido a la reserva.
 * `token` puede ser null cuando el pago se resolvió por commerceOrder (rescate del cron):
 * en ese caso no se sobreescribe `flow_token` para no borrar el que ya tuviera.
 */
async function applyFlowPaymentStatus(
  paymentStatus: FlowPaymentStatus,
  token: string | null
): Promise<ApplyFlowPaymentResult> {
  // Referencia estable de la reserva: optional.bookingId siempre es el quote_id original,
  // sin importar cuántas órdenes (50% correo, 50% página, 100%) se hayan generado.
  let optionalBookingId: string | undefined
  let optionalPaymentType: string | undefined
  if (paymentStatus.optional) {
    try {
      // Flow devuelve `optional` como STRING JSON vía getStatus (token), pero como OBJETO ya
      // deserializado vía getStatusByCommerceId (rescate del cron). Soportamos ambos: sin esto,
      // JSON.parse sobre un objeto lanzaba, bookingRef caía al commerceOrder con sufijo y el
      // rescate no encontraba la reserva (se busca por quote_id, no por commerceOrder).
      const optional =
        typeof paymentStatus.optional === 'string'
          ? JSON.parse(paymentStatus.optional)
          : paymentStatus.optional
      optionalBookingId = optional.bookingId
      optionalPaymentType = optional.paymentType
    } catch (e) {
      console.error('[paymentSync] Error parsing optional data:', e)
    }
  }
  const bookingRef = optionalBookingId || paymentStatus.commerceOrder

  // Leer la reserva ANTES de actualizar: sirve para idempotencia y para redirigir/convertir.
  const { data: existing } = await supabaseAdmin
    .from('bookings')
    .select('id, booking_type, client_name, client_email, visit_address, payment_status, amount_paid')
    .eq('quote_id', bookingRef)
    .maybeSingle()

  const bookingData = (existing as SyncedBookingData | null) || null
  const alreadyApproved = bookingData?.payment_status === 'approved'

  // Anti-retroceso: cada cotización genera VARIAS órdenes en Flow (link del correo, pago en
  // la página, reintentos). Si una reserva ya quedó aprobada, una notificación TARDÍA de otra
  // de esas órdenes (rechazada/anulada/pendiente) NO debe pisar el pago bueno ni devolver la
  // reserva a 'cancelled'. Solo un nuevo 'approved' puede seguir tocándola (es idempotente).
  if (alreadyApproved && paymentStatus.status !== 2) {
    console.warn(
      `[paymentSync] Ignorada notificación tardía (status=${paymentStatus.status}) sobre ` +
        `reserva ${bookingRef} ya aprobada. No se degrada.`
    )
    return { paymentStatus, bookingData, bookingRef, alreadyProcessed: true }
  }

  // Un cobro de SALDO que no se aprobó (rechazado, anulado o pendiente) no dice nada de la
  // reserva: la mudanza sigue en pie con lo que ya tenía. El guard de arriba solo cubre las
  // reservas con un pago aprobado; sin este, un cliente que abría el link del saldo de una
  // reserva confirmada SIN pago previo (cargada a mano, se paga al final) y lo anulaba en
  // Flow dejaba la reserva 'cancelled' y 'rejected'. Medido el 01-10-2026: 3 de las 6
  // reservas futuras con precio estaban confirmadas sin pago aprobado.
  if (optionalPaymentType === 'saldo' && paymentStatus.status !== 2) {
    console.warn(
      `[paymentSync] Cobro de saldo no aprobado (status=${paymentStatus.status}) sobre ` +
        `reserva ${bookingRef}. La reserva no se toca.`
    )
    return { paymentStatus, bookingData, bookingRef, alreadyProcessed: true }
  }

  // Flow status: 1 = pending, 2 = approved, 3 = rejected, 4 = cancelled
  let paymentStatusStr = 'pending'
  if (paymentStatus.status === 2) paymentStatusStr = 'approved'
  else if (paymentStatus.status === 3) paymentStatusStr = 'rejected'
  else if (paymentStatus.status === 4) paymentStatusStr = 'cancelled'

  const updateData: Record<string, any> = {
    flow_order: paymentStatus.flowOrder,
    payment_status: paymentStatusStr,
    payment_date: paymentStatus.paymentData?.date || new Date().toISOString(),
    payment_method: paymentStatus.paymentData?.media || 'unknown',
  }
  // Solo guardamos el token cuando lo tenemos (webhook/retorno). En el rescate por
  // commerceOrder es null y no debemos pisar el flow_token previo con null.
  if (token) updateData.flow_token = token

  // Un cobro del SALDO se marca así al crear la orden en Flow (ver
  // /api/admin/bookings/[id]/payment-link). Es el único caso en que una reserva ya
  // aprobada recibe plata nueva, y hay que sumarla en vez de ignorarla.
  const isBalancePayment = optionalPaymentType === 'saldo'

  if (paymentStatus.status === 2) {
    updateData.status = 'confirmed'
    // Deja de ser provisional => ahora SÍ consume cupo de flota.
    updateData.is_provisional = false
    // NO sobreescribir total_price: es el precio del SERVICIO (fijado al crear la reserva),
    // no el monto pagado. paymentStatus.amount es el 50% (abono) o el 95% (pago completo con
    // descuento); pisarlo con ese valor dejaba la reserva registrada a mitad/95% de su precio
    // real y descuadraba la contabilidad y los PDF regenerados.
    //
    // 'saldo' NO es una modalidad de pago, es un segundo cobro: si se guardara en
    // payment_type, `paidRatio()` dejaría de reconocer 'mitad'/'completo' y el cálculo de
    // lo pendiente se rompería para siempre en esa reserva.
    if (optionalPaymentType && !isBalancePayment) updateData.payment_type = optionalPaymentType

    const cobrado = Math.round(Number(paymentStatus.amount) || 0)

    // Todo cobro aprobado queda anotado en el libro. El token de Flow es la clave de
    // idempotencia: si ya estaba, `recorded` viene en false y no se suma nada.
    let kind: PaymentKind = 'abono'
    if (isBalancePayment) kind = 'saldo'
    else if (optionalPaymentType === 'completo') kind = 'completo'

    const ledger =
      cobrado > 0
        ? await recordPayment({
            bookingId: bookingData?.id || null,
            quoteId: bookingRef,
            flowToken: token,
            flowOrder: paymentStatus.flowOrder ?? null,
            amount: cobrado,
            kind,
            paidAt: paymentStatus.paymentData?.date || null,
          })
        : { recorded: false, ledgerAvailable: true }

    if (isBalancePayment) {
      // SUMA sobre lo que ya había. Solo si el libro confirmó que este cobro es nuevo:
      // sin esa confirmación (reintento del webhook, retorno del navegador con el mismo
      // token, o libro no disponible) sumar de nuevo cobraría dos veces el mismo saldo.
      if (ledger.recorded) {
        updateData.amount_paid = Math.max(0, Number(bookingData?.amount_paid) || 0) + cobrado
      } else {
        console.warn(
          `[paymentSync] Pago de saldo de ${bookingRef} NO sumado: ` +
            (ledger.ledgerAvailable
              ? 'ya estaba registrado (reintento).'
              : 'falta la tabla booking_payments.')
        )
      }
    } else if (
      !alreadyApproved &&
      (Number(bookingData?.amount_paid) || 0) <= 0 &&
      cobrado > 0
    ) {
      // Primer cobro: se registra solo si todavía no había un monto explícito, para que
      // un reajuste manual posterior no sea pisado por un webhook duplicado o tardío.
      updateData.amount_paid = cobrado
    }
  } else if (paymentStatus.status === 3 || paymentStatus.status === 4) {
    updateData.status = 'cancelled'
  }

  const { error: updateError } = await supabaseAdmin
    .from('bookings')
    .update(updateData)
    .eq('quote_id', bookingRef)

  if (updateError) {
    console.error('[paymentSync] Error updating booking:', updateError)
  } else {
    console.log(`[paymentSync] Booking ${bookingRef} -> status:${updateData.status}, payment:${paymentStatusStr}`)
  }

  // Idempotencia: si ya estaba aprobada, no repetimos la conversión del prospecto.
  const alreadyProcessed = alreadyApproved && paymentStatus.status === 2

  if (paymentStatus.status === 2 && !alreadyProcessed && bookingData?.id) {
    await convertProspectForBooking(bookingRef, bookingData.id, bookingData.client_email || null)
    await notifyAdminPaymentApproved({
      bookingRef,
      clientName: bookingData.client_name || null,
      amount: paymentStatus.amount || null,
      paymentType: optionalPaymentType || null,
    })
    // #05 al CLIENTE. Best-effort igual que el aviso interno: si el correo falla, el
    // pago ya está aplicado y no se revierte — el cron lo reintenta como red de
    // seguridad dentro de las 24 h. Doble idempotencia: `alreadyProcessed` evita
    // repetirlo acá, y la clave de `email_log` lo evita venga por donde venga.
    try {
      await sendBookingConfirmed(bookingData.id)
    } catch (mailErr) {
      console.error('[paymentSync] Error enviando la confirmación al cliente:', mailErr)
    }
  }

  return { paymentStatus, bookingData, bookingRef, alreadyProcessed }
}

/**
 * Avisa al dueño (por correo, vía el mismo webhook de n8n que manda las cotizaciones)
 * que se aprobó un pago. Antes esto no existía: había que revisar Flow manualmente para
 * notar que alguien pagó el abono del 50% y así poder coordinar la reserva.
 * Best-effort: si n8n falla, no bloquea ni revierte el pago ya procesado.
 */
async function notifyAdminPaymentApproved(params: {
  bookingRef: string
  clientName: string | null
  amount: number | null
  paymentType: string | null
}): Promise<void> {
  const adminEmail = process.env.ADMIN_NOTIFICATION_EMAIL
  if (!adminEmail) return

  await sendSystemEmail(
    {
      event: 'payment_approved',
      to: adminEmail,
      quote_id: params.bookingRef,
      cliente: params.clientName,
      monto: params.amount,
      tipo_pago: params.paymentType === 'mitad' ? 'Abono 50%' : 'Pago completo',
      fecha: new Date().toISOString(),
    },
    { label: 'admin-notify', timeoutMs: 8000 }
  )
}

/**
 * Marca los prospectos correspondientes como convertidos cuando el pago se aprueba.
 *
 * El pago es la fuente de verdad: un lead pagado deja de ser prospecto sin importar
 * el estado manual que tuviera (new/contacted/no_response/lost).
 *
 * 1) Por quote_id (estable) => cubre el caso normal del cotizador web.
 * 2) Por email => la misma persona suele tener varias filas de lead (cada re-cotización
 *    con otra fecha/dirección genera otro lead_key). Al pagar, TODAS sus filas abiertas
 *    se cierran como 'converted' para que no queden huérfanas en el panel de Prospectos.
 */
async function convertProspectForBooking(
  bookingRef: string,
  bookingRowId: string,
  clientEmail: string | null
): Promise<void> {
  try {
    const convertedFields = {
      status: 'converted',
      converted_booking_id: bookingRowId,
      updated_at: new Date().toISOString(),
    }

    const { data: byQuote, error: byQuoteErr } = await supabaseAdmin
      .from('quote_prospects')
      .update(convertedFields)
      .eq('quote_id', bookingRef)
      .neq('status', 'converted')
      .select('id')

    if (byQuoteErr) {
      console.error('[paymentSync] Error converting prospect by quote_id:', byQuoteErr)
    }

    let byEmailCount = 0
    if (clientEmail) {
      const { data: byEmail, error: byEmailErr } = await supabaseAdmin
        .from('quote_prospects')
        .update(convertedFields)
        .eq('email', clientEmail.toLowerCase().trim())
        .neq('status', 'converted')
        .select('id')

      if (byEmailErr) {
        console.error('[paymentSync] Error converting prospects by email:', byEmailErr)
      }
      byEmailCount = byEmail?.length || 0
    }

    console.log(
      `[paymentSync] Prospect conversion for ${bookingRef} (${clientEmail}): ` +
        `${byQuote?.length || 0} by quote_id, ${byEmailCount} by email`
    )
  } catch (prospectErr) {
    console.error('[paymentSync] Exception updating prospect:', prospectErr)
  }
}
