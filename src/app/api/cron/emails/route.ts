import { NextRequest, NextResponse } from 'next/server'
import { GOOGLE_REVIEW_URL } from '@/lib/googleProfile'
import { supabaseAdmin } from '@/lib/supabase'
import { flowService } from '@/lib/flowService'
import { computeQuoteAmounts, createQuoteFlowOrder } from '@/lib/quoteCheckout'
import { chileTodayString } from '@/lib/vehicleAssignment'
import { bookingConfirmedSkipReason, sendBookingConfirmed } from '@/lib/transactionalEmails'
import {
  bookingScope,
  claimAndSend,
  chileHour,
  emailGatesStatus,
  emailLogKey,
  isWithinSendWindow,
  markSuperseded,
  normalizeEmail,
  personScope,
  readResolvedKeys,
  type SendOutcome,
  type SkipReason,
} from '@/lib/emailLog'
import { siteUrl } from '@/lib/siteUrl'
import { getMarketingConfig, getOrCreateReferralCode, referralsLive } from '@/lib/coupons'
import { couponValueLabel, type MarketingConfig } from '@/lib/couponTypes'
import { customerIdByEmail } from '@/lib/webCoupon'

// La corrida envía decenas de correos uno por uno: con el límite por defecto se cortaba a
// medias (ver el orden de las reglas en `runEmailCron`).
export const maxDuration = 300

/**
 * Cron de correos automáticos. Fase 1: #05 reserva confirmada (red de seguridad),
 * #06 falta tu pago, #06b recuperación de impagos vencidos, #07 pago rechazado.
 *
 * ES UN RECONCILIADOR, NO UNA COLA. Cada corrida deriva qué corresponde enviar del
 * estado ACTUAL de `bookings`; `email_log` solo dice qué ya se envió. Por eso las
 * reservas impagas que existían desde antes del sistema quedan cubiertas sin ningún
 * script de backfill — y ese script era justamente el peligroso, porque el filtro que
 * protege al flujo nuevo es el mismo que las protege a ellas.
 *
 * El corte de secuencia sale gratis: al pagarse, la reserva deja de cumplir el WHERE
 * y no genera más candidatos. El `precheck` de cada envío cubre el caso de que el pago
 * entre entre que se eligió al candidato y el momento de postear a n8n.
 */

/** Los tres tramos del #06, medidos desde la creación de la reserva. */
const PAYMENT_DUE_STEPS = [
  { key: '2h', hours: 2 },
  { key: '24h', hours: 24 },
  { key: '72h', hours: 72 },
] as const

/** Más allá de esto una reserva impaga ya no se persigue con el #06. */
const PAYMENT_DUE_MAX_AGE_DAYS = 30
/** Piso del #06b: no se le escribe a alguien por una cotización de hace medio año. */
const RECOVERY_MAX_AGE_DAYS = 180
/** Ventana del #07 tras el rechazo de Flow. */
const REJECTED_WINDOW_HOURS = 48
/** Ventana de la red de seguridad del #05. */
const CONFIRMED_WINDOW_HOURS = 24

const BOOKING_FIELDS = `
  id, quote_id, client_name, client_email, client_phone,
  scheduled_date, scheduled_time, origin_address, destination_address,
  total_price, payment_type, payment_status, payment_date, status, created_at
`

interface BookingRow {
  id: string
  quote_id: string
  client_name: string | null
  client_email: string | null
  client_phone: string | null
  scheduled_date: string | null
  scheduled_time: string | null
  origin_address: string | null
  destination_address: string | null
  total_price: number | null
  payment_type: string | null
  payment_status: string | null
  payment_date: string | null
  status: string | null
  created_at: string
}

type Tally = Record<string, number>

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()
}

function hoursSince(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / (60 * 60 * 1000)
}

function tallyUp(tally: Tally, emailType: string, outcome: SendOutcome): void {
  // El motivo se incluye también para 'deferred'. Agruparlos costó cinco días de
  // no poder distinguir "el envío está apagado" de "la lista blanca lo filtró":
  // los dos casos no dejan fila en email_log, así que el contador es la ÚNICA
  // señal disponible desde afuera.
  const reason =
    outcome.outcome === 'skipped' || outcome.outcome === 'deferred' ? `:${outcome.reason}` : ''
  tally[`${emailType}.${outcome.outcome}${reason}`] = (tally[`${emailType}.${outcome.outcome}${reason}`] || 0) + 1
}

function clientBlock(b: BookingRow) {
  return {
    nombre: b.client_name,
    email: b.client_email,
    telefono: b.client_phone,
  }
}

function bookingBlock(b: BookingRow) {
  return {
    fecha: b.scheduled_date,
    hora: b.scheduled_time,
    origen: b.origin_address,
    destino: b.destination_address,
    precio_total: b.total_price,
  }
}

/**
 * Emite una orden de pago NUEVA para el abono del 50%.
 *
 * No se reusa `flow_token`: está NULL en todas las reservas impagas (nunca llegaron a
 * pagar) y los links de Flow caducan igual. `optional.bookingId` va con el quote_id,
 * así que cuando el cliente pague, `paymentSync` resuelve la misma reserva de siempre
 * sin importar cuántas órdenes se hayan generado para ella.
 *
 * Lanza si Flow no está disponible: un "falta tu pago" sin link no sirve de nada, y
 * fallar deja la fila reintentable en la próxima corrida en vez de quemar la clave.
 */
async function freshPaymentUrl(b: BookingRow): Promise<string> {
  if (!flowService.isConfigured()) throw new Error('Flow no está configurado')
  if (!b.client_email) throw new Error('la reserva no tiene email')

  const amounts = computeQuoteAmounts(b.total_price || 0)
  const order = await createQuoteFlowOrder({
    quoteId: b.quote_id,
    paymentType: 'mitad',
    amount: amounts.abono50,
    email: b.client_email,
    subject: 'Servicio de Mudanza - Abono 50%',
  })
  return order.url
}

/**
 * Revalida contra la base justo antes de postear a n8n. Corta la secuencia si la
 * reserva dejó de estar en el estado que la hizo candidata.
 */
function stillMatches(bookingId: string, expected: string) {
  return async (): Promise<SkipReason | null> => {
    const { data } = await supabaseAdmin
      .from('bookings')
      .select('payment_status')
      .eq('id', bookingId)
      .maybeSingle()
    return data?.payment_status === expected ? null : 'converted'
  }
}

// ---------------------------------------------------------------------------
// #06 — Falta tu pago (+2 h / +24 h / +72 h)
// ---------------------------------------------------------------------------

async function rulePaymentDue(tally: Tally): Promise<void> {
  // Los tres filtros que evitan el desastre: `status='pending'` deja fuera las
  // canceladas y las que YA SE ATENDIERON sin registrar el pago; `scheduled_date >= hoy`
  // deja fuera las mudanzas que ya ocurrieron; y los 30 días acotan el resto.
  const { data, error } = await supabaseAdmin
    .from('bookings')
    .select(BOOKING_FIELDS)
    .eq('payment_status', 'pending')
    .eq('status', 'pending')
    .gte('scheduled_date', chileTodayString())
    .gt('created_at', hoursAgo(PAYMENT_DUE_MAX_AGE_DAYS * 24))
    .not('client_email', 'is', null)

  if (error) {
    console.error('[cron/emails] Error buscando impagas vigentes:', error)
    return
  }

  // Quien ya pagó otra reserva para esa misma fecha no debe nada: la impaga es otro intento suyo.
  // Eduardo Torrealba (RES-000443 pagada, RES-000445 pendiente, 30-10-2026) recibía
  // «falta tu pago» con un link de Flow, y podía pagar dos veces.
  const pending = (data || []) as BookingRow[]
  const paidKey = (email: string | null, date: string | null) => `${String(email || '').trim().toLowerCase()}|${date}`
  const pendingDates = Array.from(new Set(pending.map((b) => b.scheduled_date).filter(Boolean))) as string[]
  const { data: paidRows, error: paidError } = pendingDates.length
    ? await supabaseAdmin.from('bookings').select('client_email, scheduled_date').eq('payment_status', 'approved').in('scheduled_date', pendingDates)
    : { data: [], error: null }
  if (paidError) {
    console.error('[cron/emails] Error buscando reservas pagadas:', paidError)
    return
  }
  const paid = new Set((paidRows || []).map((r) => paidKey(r.client_email, r.scheduled_date)))

  for (const b of pending) {
    if (paid.has(paidKey(b.client_email, b.scheduled_date))) {
      tally['06_payment_due.ya_pago_otra'] = (tally['06_payment_due.ya_pago_otra'] || 0) + 1
      continue
    }
    const age = hoursSince(b.created_at)
    const due = PAYMENT_DUE_STEPS.filter((s) => age >= s.hours)
    if (due.length === 0) continue

    // Solo sale el tramo MÁS ALTO vencido. Sin esto, cualquier reserva de más de
    // 72 h dispararía el +2h, el +24h y el +72h en la misma corrida.
    const top = due[due.length - 1]
    for (const skipped of due.slice(0, -1)) {
      await markSuperseded(
        `06_payment_due_${skipped.key}`,
        b.client_email || '',
        bookingScope(b.id),
        new Date(new Date(b.created_at).getTime() + skipped.hours * 3600_000)
      )
    }

    const emailType = `06_payment_due_${top.key}`
    const outcome = await claimAndSend({
      emailType,
      recipient: b.client_email,
      scopeKey: bookingScope(b.id),
      scheduledFor: new Date(new Date(b.created_at).getTime() + top.hours * 3600_000),
      bookingId: b.id,
      precheck: stillMatches(b.id, 'pending'),
      payload: async () => ({
        event: 'payment_due',
        step: top.key,
        quote_id: b.quote_id,
        booking_id: b.id,
        cliente: clientBlock(b),
        reserva: bookingBlock(b),
        pago: {
          flow_payment_url: await freshPaymentUrl(b),
          monto: computeQuoteAmounts(b.total_price || 0).abono50,
          tipo: 'abono_50',
        },
      }),
    })
    tallyUp(tally, emailType, outcome)
  }
}

// ---------------------------------------------------------------------------
// #06b — Recuperación de impagos cuya fecha ya pasó
// ---------------------------------------------------------------------------

/**
 * Complemento exacto del #06 (`scheduled_date <` en vez de `>=`), así que ninguna
 * reserva puede recibir los dos. Un solo disparo, sin secuencia y SIN link de pago:
 * el precio y la fecha ya no valen, el CTA es volver a cotizar.
 *
 * Detrás de EMAIL_RECOVERY_ENABLED porque es un envío de una vez sobre una lista
 * histórica, no un flujo permanente. Después del primer disparo, la clave única de
 * `email_log` lo hace irrepetible aunque la variable quede encendida.
 */
async function ruleRecovery(tally: Tally): Promise<void> {
  if (process.env.EMAIL_RECOVERY_ENABLED !== '1') return

  const { data, error } = await supabaseAdmin
    .from('bookings')
    .select(BOOKING_FIELDS)
    .eq('payment_status', 'pending')
    .eq('status', 'pending')
    .lt('scheduled_date', chileTodayString())
    .gt('created_at', hoursAgo(RECOVERY_MAX_AGE_DAYS * 24))
    .not('client_email', 'is', null)

  if (error) {
    console.error('[cron/emails] Error buscando impagas vencidas:', error)
    return
  }

  for (const b of (data || []) as BookingRow[]) {
    const outcome = await claimAndSend({
      emailType: '06b_recovery',
      recipient: b.client_email,
      scopeKey: bookingScope(b.id),
      scheduledFor: new Date(),
      bookingId: b.id,
      precheck: stillMatches(b.id, 'pending'),
      payload: {
        event: 'quote_recovery',
        quote_id: b.quote_id,
        booking_id: b.id,
        cliente: clientBlock(b),
        reserva: bookingBlock(b),
        cotizador_url: siteUrl(),
      },
    })
    tallyUp(tally, '06b_recovery', outcome)
  }
}

// ---------------------------------------------------------------------------
// #07 — Pago rechazado
// ---------------------------------------------------------------------------

/**
 * Único de la Fase 1 que NO filtra por `status='pending'`: `paymentSync` deja las
 * reservas rechazadas en `status='cancelled'`, así que exigirlo las dejaría a todas
 * fuera. Reviven bien (eran provisionales, no consumían cupo), pero OJO: el webhook
 * no revalida el cupo al re-aprobar, así que si el horario se llenó mientras tanto
 * pueden quedar dos reservas en el mismo bloque. Riesgo conocido, no resuelto acá.
 */
async function rulePaymentRejected(tally: Tally): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from('bookings')
    .select(BOOKING_FIELDS)
    .eq('payment_status', 'rejected')
    .gt('payment_date', hoursAgo(REJECTED_WINDOW_HOURS))
    .not('client_email', 'is', null)

  if (error) {
    console.error('[cron/emails] Error buscando pagos rechazados:', error)
    return
  }

  for (const b of (data || []) as BookingRow[]) {
    const outcome = await claimAndSend({
      emailType: '07_payment_rejected',
      recipient: b.client_email,
      scopeKey: bookingScope(b.id),
      scheduledFor: b.payment_date || new Date().toISOString(),
      bookingId: b.id,
      transactional: true,
      precheck: stillMatches(b.id, 'rejected'),
      payload: async () => ({
        event: 'payment_rejected',
        quote_id: b.quote_id,
        booking_id: b.id,
        cliente: clientBlock(b),
        reserva: bookingBlock(b),
        pago: {
          flow_payment_url: await freshPaymentUrl(b),
          monto: computeQuoteAmounts(b.total_price || 0).abono50,
          tipo: 'abono_50',
        },
      }),
    })
    tallyUp(tally, '07_payment_rejected', outcome)
  }
}

// ---------------------------------------------------------------------------
// #05 — Reserva confirmada (red de seguridad)
// ---------------------------------------------------------------------------

/**
 * El #05 se manda en línea desde `paymentSync` al aprobarse el pago. Esto es solo la
 * red: cubre que n8n estuviera caído en ese momento, o que la reserva se haya
 * rescatado por otro camino. Si el envío en línea funcionó, la clave ya está tomada
 * y esto no hace nada.
 */
async function ruleBookingConfirmedSafetyNet(tally: Tally): Promise<void> {
  const desde = hoursAgo(CONFIRMED_WINDOW_HOURS)

  const { data, error } = await supabaseAdmin
    .from('bookings')
    .select(`${BOOKING_FIELDS}, flow_token, is_provisional, booking_type, original_price, adjusted_price`)
    .eq('payment_status', 'approved')
    .gt('payment_date', desde)
    .not('client_email', 'is', null)

  if (error) {
    console.error('[cron/emails] Error buscando reservas confirmadas:', error)
    return
  }

  // Reservas cargadas desde el panel en las últimas 24 h, confirmadas o pagadas. El #05
  // se les manda en línea al crearlas; esto cubre que n8n estuviera caído en ese momento.
  // No tienen `payment_date` (el modal de Nueva Reserva no lo escribe), por eso la
  // ventana va por creación o por confirmación.
  const { data: manuales, error: manualesError } = await supabaseAdmin
    .from('bookings')
    .select(`${BOOKING_FIELDS}, flow_token, is_provisional, booking_type, original_price, adjusted_price`)
    .is('flow_token', null)
    .or(`created_at.gt.${desde},confirmed_at.gt.${desde}`)
    .not('client_email', 'is', null)

  if (manualesError) {
    console.error('[cron/emails] Error buscando reservas manuales recientes:', manualesError)
  }

  type Candidata = BookingRow & {
    flow_token?: string | null
    is_provisional?: boolean | null
    booking_type?: string | null
    original_price?: number | null
    adjusted_price?: number | null
  }
  const candidatas = new Map<string, Candidata>()
  for (const b of [...(data || []), ...(manuales || [])] as Candidata[]) {
    candidatas.set(b.id, b)
  }

  for (const b of candidatas.values()) {
    // Lo que entró por Flow sigue igual que siempre. Lo manual pasa por las guardas:
    // bloqueos de agenda, correos que no son correos, fechas que ya pasaron.
    if (!b.flow_token && bookingConfirmedSkipReason(b)) continue
    tallyUp(tally, '05_booking_confirmed', await sendBookingConfirmed(b.id))
  }
}

// ---------------------------------------------------------------------------
// Fase 2 — Secuencia de cotización (#01 a #04)
// ---------------------------------------------------------------------------

const QUOTE_STEPS = [
  { key: '01_quote', hours: 0, event: 'quote_auto' },
  { key: '02_reminder', hours: 24, event: 'quote_reminder' },
  { key: '03_social_proof', hours: 72, event: 'quote_social_proof' },
  { key: '04_last_call', hours: 168, event: 'quote_last_call' },
] as const

/**
 * Fecha desde la cual la secuencia de cotización considera prospectos.
 *
 * SIN ESTE CORTE, la primera corrida le escribe a las 720 personas que cotizaron
 * alguna vez — muchas de hace meses, con precios que ya no existen. Es la misma
 * clase de error que el filtro del #06 evita en las reservas impagas: un sistema
 * que deriva del estado actual no debe alcanzar hacia atrás en el tiempo.
 */
const QUOTE_SEQUENCE_START = '2026-08-18T00:00:00Z'

const PROSPECT_FIELDS = `
  id, quote_id, name, email, origin_address, destination_address,
  scheduled_date, scheduled_time, total_price, adjusted_price, is_flexible,
  recommended_vehicle, pdf_url, status, created_at, quote_sent_at
`

interface ProspectRow {
  id: string
  quote_id: string | null
  name: string | null
  email: string | null
  origin_address: string | null
  destination_address: string | null
  scheduled_date: string | null
  scheduled_time: string | null
  total_price: number | null
  adjusted_price: number | null
  is_flexible: boolean | null
  recommended_vehicle: string | null
  pdf_url: string | null
  status: string | null
  created_at: string
  /** Se envió la cotización por correo a mano (panel o botón «Enviar» de la web). */
  quote_sent_at: string | null
}

/**
 * Secuencia de cotización. Se cuenta POR PERSONA, no por fila: alguien que
 * re-cotiza tres veces en la semana continúa donde iba en vez de volver a
 * empezar (hay 720 filas para 652 personas).
 *
 * Corta al convertir: si esa persona tiene cualquier reserva pagada, no recibe
 * más correos de esta secuencia.
 */
async function ruleQuoteSequence(tally: Tally): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from('quote_prospects')
    .select(PROSPECT_FIELDS)
    .gt('created_at', QUOTE_SEQUENCE_START)
    .not('email', 'is', null)
    .not('status', 'in', '("converted","lost")')
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[cron/emails] Error buscando prospectos:', error)
    return
  }

  // Quién ya pagó alguna vez: una sola consulta en vez de una por prospecto.
  const { data: pagados } = await supabaseAdmin
    .from('bookings')
    .select('client_email')
    .eq('payment_status', 'approved')
    .not('client_email', 'is', null)
  const convertidos = new Set((pagados || []).map((b) => normalizeEmail(b.client_email)))

  // Borradores del panel (guardados sin enviar, add_quote_draft.sql): el cliente no los ha
  // visto, así que no reciben correos. Sin la migración, la consulta falla y no hay borradores.
  const { data: draftRows, error: draftError } = await supabaseAdmin.from('quote_prospects').select('id').eq('is_draft', true)
  const drafts = new Set(draftError ? [] : (draftRows || []).map((d: { id: string }) => d.id))

  // Lo ya resuelto no vuelve a la base: casi todas las personas no tienen nada pendiente.
  const resolved = await readResolvedKeys(QUOTE_STEPS.map((s) => s.key))

  // La fila MÁS RECIENTE de cada persona manda: es su cotización vigente.
  const porPersona = new Map<string, ProspectRow>()
  for (const p of (data || []) as ProspectRow[]) {
    const key = normalizeEmail(p.email)
    if (!key || convertidos.has(key)) continue
    if (!porPersona.has(key)) porPersona.set(key, p)
  }

  for (const [email, p] of porPersona) {
    if (drafts.has(p.id)) {
      tally['quote.skip:borrador'] = (tally['quote.skip:borrador'] || 0) + 1
      continue
    }
    const age = hoursSince(p.created_at)
    const due = QUOTE_STEPS.filter((s) => age >= s.hours)
    if (due.length === 0) continue
    const top = due[due.length - 1]

    for (const skipped of due.slice(0, -1)) {
      if (resolved.has(emailLogKey(skipped.key, email, personScope(email)))) continue
      await markSuperseded(
        skipped.key,
        email,
        personScope(email),
        new Date(new Date(p.created_at).getTime() + skipped.hours * 3600_000)
      )
    }

    const topStatus = resolved.get(emailLogKey(top.key, email, personScope(email)))
    if (topStatus) {
      tallyUp(tally, top.key, { outcome: 'duplicate', status: topStatus })
      continue
    }

    // Un solo correo con la cotización (decisión de Tomás, 16-sep-2026). Si ya se le
    // mandó a mano —con el PDF y los links de pago, desde el panel o desde el botón
    // «Enviar» de la web—, el #01 automático sería un segundo «tu cotización está lista»
    // dentro de la misma hora. Se marca como reemplazado y la secuencia sigue igual desde
    // el #02: no se adelanta nada, solo se evita el duplicado.
    if (top.key === '01_quote' && p.quote_sent_at) {
      await markSuperseded(
        top.key,
        email,
        personScope(email),
        new Date(new Date(p.created_at).getTime() + top.hours * 3600_000)
      )
      tally['01_quote.superseded:ya_enviada'] = (tally['01_quote.superseded:ya_enviada'] || 0) + 1
      continue
    }

    const precio = p.adjusted_price ?? p.total_price ?? 0
    const outcome = await claimAndSend({
      emailType: top.key,
      recipient: email,
      scopeKey: personScope(email),
      scheduledFor: new Date(new Date(p.created_at).getTime() + top.hours * 3600_000),
      prospectId: p.id,
      // Re-lee el prospecto: pudo convertirse entre que se eligió y este momento.
      precheck: async () => {
        const { data: fresh } = await supabaseAdmin
          .from('quote_prospects')
          .select('status')
          .eq('id', p.id)
          .maybeSingle()
        return fresh?.status === 'converted' || fresh?.status === 'lost' ? 'converted' : null
      },
      payload: {
        event: top.event,
        step: top.key,
        quote_id: p.quote_id,
        prospect_id: p.id,
        cliente: { nombre: p.name, email, telefono: null },
        cotizacion: {
          fecha: p.scheduled_date,
          hora: p.scheduled_time,
          origen: p.origin_address,
          destino: p.destination_address,
          vehiculo: p.recommended_vehicle,
          precio_total: precio,
          precio_50: computeQuoteAmounts(precio).abono50,
          es_flexible: p.is_flexible || false,
        },
        pdf_url: p.pdf_url,
        cotizador_url: siteUrl(),
      },
    })
    tallyUp(tally, top.key, outcome)
  }
}

// ---------------------------------------------------------------------------
// Fase 3 — Antes y después del servicio (#08 a #11)
// ---------------------------------------------------------------------------

/** Fecha 'YYYY-MM-DD' en Chile, corrida N días (negativo = pasado). */
function chileDateOffset(days: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(
    new Date(Date.now() + days * 24 * 3600_000)
  )
}

/** Ficha del camión asignado, para el #09. Devuelve null si no hay asignación. */
async function vehicleInfo(vehicleId: number | null): Promise<Record<string, unknown> | null> {
  if (!vehicleId) return null
  const { data } = await supabaseAdmin.from('fleet_config').select('vehicles').maybeSingle()
  const lista = (data?.vehicles as Array<Record<string, unknown>> | undefined) || []
  const v = lista.find((x) => Number(x.id) === Number(vehicleId))
  if (!v) return null
  // `driver` y `phone` están vacíos en los tres camiones (verificado 2026-08-18).
  // Se mandan solo si alguien los cargó en Flota; si no, el correo los omite en
  // vez de mostrar un campo en blanco.
  return {
    nombre: v.name || null,
    color: v.color || null,
    chofer: v.driver || null,
    telefono_chofer: v.phone || null,
  }
}

const SERVICE_FIELDS = `${BOOKING_FIELDS}, vehicle_id`

/** Reservas pagadas con mudanza en una fecha exacta. */
async function bookingsOnDate(date: string): Promise<(BookingRow & { vehicle_id: number | null })[]> {
  const { data, error } = await supabaseAdmin
    .from('bookings')
    .select(SERVICE_FIELDS)
    .eq('payment_status', 'approved')
    .in('status', ['confirmed', 'completed'])
    .eq('scheduled_date', date)
    .not('client_email', 'is', null)

  if (error) {
    console.error(`[cron/emails] Error buscando reservas del ${date}:`, error)
    return []
  }
  return (data || []) as (BookingRow & { vehicle_id: number | null })[]
}

/** #08 Faltan 3 días — checklist de preparación. */
async function ruleServiceD3(tally: Tally): Promise<void> {
  for (const b of await bookingsOnDate(chileDateOffset(3))) {
    tallyUp(
      tally,
      '08_service_d3',
      await claimAndSend({
        emailType: '08_service_d3',
        recipient: b.client_email,
        scopeKey: bookingScope(b.id),
        scheduledFor: new Date(),
        bookingId: b.id,
        payload: {
          event: 'service_reminder_d3',
          quote_id: b.quote_id,
          booking_id: b.id,
          cliente: clientBlock(b),
          reserva: bookingBlock(b),
        },
      })
    )
  }
}

/** #09 Es mañana — hora, direcciones y camión asignado. */
async function ruleServiceD1(tally: Tally): Promise<void> {
  for (const b of await bookingsOnDate(chileDateOffset(1))) {
    tallyUp(
      tally,
      '09_service_d1',
      await claimAndSend({
        emailType: '09_service_d1',
        recipient: b.client_email,
        scopeKey: bookingScope(b.id),
        scheduledFor: new Date(),
        bookingId: b.id,
        // Transaccional: es información operativa del día siguiente. No se
        // retiene por tope de frecuencia.
        transactional: true,
        payload: async () => ({
          event: 'service_reminder_d1',
          quote_id: b.quote_id,
          booking_id: b.id,
          cliente: clientBlock(b),
          reserva: bookingBlock(b),
          vehiculo: await vehicleInfo(b.vehicle_id),
        }),
      })
    )
  }
}

/**
 * #10 Reseña de Google, el día después de la mudanza.
 *
 * Se dispara con que la FECHA haya pasado, no con `service_completed_at`: ese
 * campo lo tienen 7 de 100 reservas porque nadie marca el servicio como
 * terminado en el panel. Colgarlo de ahí sería construir un correo que no sale.
 *
 * Mira hacia atrás REVIEW_LOOKBACK_DAYS días y no solo «ayer»: si la tarea no corre un día
 * (pasó del 5 al 12 de octubre de 2026), la reseña se pide al siguiente en vez de perderse.
 * No duplica: la fila de `email_log` es una por reserva, así que a quien ya se le pidió no
 * se le vuelve a escribir. El correo dice «ayer» o «hace unos días» según `dias`.
 */
const REVIEW_LOOKBACK_DAYS = 10

/**
 * Código de referido del cliente para el correo de después del servicio (Tomás, 19-10-2026).
 * Se crea si todavía no tiene (ya fue atendido: la reserva está pagada). null si el programa
 * está apagado o no se pudo.
 */
async function referralFor(email: string, config: MarketingConfig): Promise<{ code: string; descuento: string; url: string } | null> {
  const customerId = await customerIdByEmail(email)
  const code = customerId ? await getOrCreateReferralCode(customerId, 'if-attended').catch(() => null) : null
  if (!code) return null
  return {
    code,
    descuento: couponValueLabel(config.referredKind, config.referredValue) + (config.referredCap ? ` (hasta $${config.referredCap.toLocaleString('es-CL')})` : ''),
    url: siteUrl(),
  }
}

async function ruleReviewRequest(tally: Tally): Promise<void> {
  const url = process.env.GOOGLE_REVIEW_URL?.trim() || GOOGLE_REVIEW_URL
  const marketing = await getMarketingConfig()
  const referrals = marketing.available && referralsLive(marketing.config)
  for (let dias = 1; dias <= REVIEW_LOOKBACK_DAYS; dias++) {
    for (const b of await bookingsOnDate(chileDateOffset(-dias))) {
      tallyUp(
        tally,
        '10_review_request',
        await claimAndSend({
          emailType: '10_review_request',
          recipient: b.client_email,
          scopeKey: bookingScope(b.id),
          scheduledFor: new Date(),
          bookingId: b.id,
          payload: {
            event: 'review_request',
            quote_id: b.quote_id,
            booking_id: b.id,
            cliente: clientBlock(b),
            reserva: bookingBlock(b),
            review_url: url,
            dias,
            referido: referrals && b.client_email ? await referralFor(b.client_email, marketing.config) : null,
          },
        })
      )
    }
  }
}

/** #11 Reactivación, a los 30 días de la mudanza. */
async function ruleReactivation(tally: Tally): Promise<void> {
  for (const b of await bookingsOnDate(chileDateOffset(-30))) {
    tallyUp(
      tally,
      '11_reactivation',
      await claimAndSend({
        emailType: '11_reactivation',
        recipient: b.client_email,
        scopeKey: bookingScope(b.id),
        scheduledFor: new Date(),
        bookingId: b.id,
        payload: {
          event: 'reactivation',
          quote_id: b.quote_id,
          booking_id: b.id,
          cliente: clientBlock(b),
          cotizador_url: siteUrl(),
        },
      })
    )
  }
}

// ---------------------------------------------------------------------------
// Fase 4 — Resumen diario interno
// ---------------------------------------------------------------------------

/**
 * Un correo al día al equipo, no uno por lead. La diferencia medida es 80
 * correos al mes en digest contra 400 sueltos.
 *
 * El scope es la fecha, así que la clave única garantiza uno por día pase lo
 * que pase con el cron.
 */
async function ruleInternalDigest(tally: Tally): Promise<void> {
  const to = process.env.ADMIN_NOTIFICATION_EMAIL
  if (!to) return

  const hoy = chileDateOffset(0)
  // Se manda una vez al día, en la primera corrida a partir de las 09:00 Chile.
  if (chileHour() < 9) return

  const desde24h = hoursAgo(24)

  const [sinContactar, pagos, fallidos, manana] = await Promise.all([
    supabaseAdmin
      .from('quote_prospects')
      .select('id, name, email, total_price, created_at')
      .eq('status', 'new')
      .lt('created_at', desde24h)
      .gt('created_at', hoursAgo(24 * 7)),
    supabaseAdmin
      .from('bookings')
      .select('client_name, total_price')
      .eq('payment_status', 'approved')
      .gt('payment_date', desde24h),
    supabaseAdmin
      .from('bookings')
      .select('client_name, client_email, total_price')
      .in('payment_status', ['rejected', 'cancelled'])
      .gt('payment_date', desde24h),
    bookingsOnDate(chileDateOffset(1)),
  ])

  const outcome = await claimAndSend({
    emailType: 'digest_interno',
    recipient: to,
    scopeKey: `dg:${hoy}`,
    scheduledFor: new Date(),
    // Interno y operativo: no cuenta contra el tope de la persona ni espera ventana.
    transactional: true,
    payload: {
      event: 'internal_digest',
      fecha: hoy,
      leads_sin_contactar: (sinContactar.data || []).map((l) => ({
        nombre: l.name,
        email: l.email,
        monto: l.total_price,
        desde: l.created_at,
      })),
      pagos_recibidos: (pagos.data || []).map((p) => ({ cliente: p.client_name, monto: p.total_price })),
      pagos_fallidos: (fallidos.data || []).map((p) => ({ cliente: p.client_name, email: p.client_email })),
      mudanzas_manana: manana.map((b) => ({
        cliente: b.client_name,
        hora: b.scheduled_time,
        origen: b.origin_address,
        destino: b.destination_address,
      })),
    },
  })
  tallyUp(tally, 'digest_interno', outcome)
}

// ---------------------------------------------------------------------------
// Orquestación
// ---------------------------------------------------------------------------

async function runEmailCron(force: boolean): Promise<Record<string, unknown>> {
  // Los transaccionales que nacen de una acción del cliente salen igual por su propia
  // vía (el #05 en línea desde paymentSync). Acá, fuera de horario, no se barre nada:
  // ninguna de estas reglas es tan urgente como para escribirle a alguien a las 03:00.
  if (!force && !isWithinSendWindow()) {
    return { skipped: 'quiet_hours', window: '09:00-21:00 America/Santiago', config: emailGatesStatus() }
  }

  const tally: Tally = {}
  await ruleBookingConfirmedSafetyNet(tally)
  await rulePaymentDue(tally)
  await ruleRecovery(tally)
  await rulePaymentRejected(tally)
  // Los correos del servicio (faltan 3 días, mañana, reseña, reactivación) y el resumen
  // interno van ANTES de la secuencia de cotizaciones, que es la larga. Medido el
  // 13-10-2026: cada corrida se cortaba cerca de un minuto después de empezar, siempre
  // dentro de la secuencia, y estas reglas —que estaban al final— no corrían: del 5 al 12
  // de octubre no salió ningún correo de servicio ni de reseña. Son pocos por día y
  // dependen de una fecha exacta: si no corren ese día, se pierden.
  await ruleServiceD3(tally)
  await ruleServiceD1(tally)
  await ruleReviewRequest(tally)
  await ruleReactivation(tally)
  await ruleInternalDigest(tally)
  await ruleQuoteSequence(tally)

  const sent = Object.entries(tally)
    .filter(([k]) => k.endsWith('.sent'))
    .reduce((n, [, v]) => n + v, 0)

  // El estado de las puertas va TAMBIÉN al log, no solo a la respuesta: Vercel
  // descarta el cuerpo de la respuesta de sus crons, así que sin esta línea el
  // diagnóstico solo sería visible llamando al endpoint a mano con el secreto.
  const config = emailGatesStatus()
  console.log(
    `[cron/emails] ${sent} enviados. Detalle: ${JSON.stringify(tally)}. Puertas: ${JSON.stringify(config)}`
  )
  return { sent, detail: tally, config }
}

/** Disparo automático por Vercel Cron. */
export async function GET(request: NextRequest) {
  // Sin el secreto configurado no corre: quedaría abierta a cualquiera.
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET no está configurado' }, { status: 503 })
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  try {
    return NextResponse.json({ success: true, ...(await runEmailCron(false)) })
  } catch (error) {
    console.error('[cron/emails] Exception:', error)
    return NextResponse.json(
      { error: 'Error en el cron de correos', details: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    )
  }
}

/**
 * Disparo manual. `?force=1` ignora la ventana horaria para poder probar a cualquier
 * hora — no salta ni el dry-run ni la lista blanca, que son las que protegen de verdad.
 */
export async function POST(request: NextRequest) {
  // Sin el secreto configurado no corre: quedaría abierta a cualquiera.
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET no está configurado' }, { status: 503 })
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  const force = new URL(request.url).searchParams.get('force') === '1'
  try {
    return NextResponse.json({ success: true, ...(await runEmailCron(force)) })
  } catch (error) {
    console.error('[cron/emails] Exception:', error)
    return NextResponse.json(
      { error: 'Error en el cron de correos', details: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    )
  }
}
