/**
 * Helper único de envío de correos automáticos. TODO correo automático pasa por acá:
 * es el que garantiza que no se manda dos veces lo mismo, que nadie recibe demasiados,
 * y que cada decisión queda registrada en `email_log`.
 *
 * Diseño en database/migrations/add_email_log.sql. Tres decisiones que conviene tener
 * presentes antes de tocar este archivo:
 *
 *  1) EL `INSERT` ES EL CANDADO. La clave única (email_type, recipient, scope_key) hace
 *     que reclamar un envío sea un INSERT que o entra o choca. Es atómico, así que dos
 *     ejecuciones simultáneas del cron no pueden mandar el mismo correo, y no hace falta
 *     ni transacción ni un estado 'sending'.
 *
 *  2) EL PAYLOAD NO SE GUARDA. Un reintento reconstruye el payload desde cero, porque los
 *     links de pago de Flow caducan: reenviar el payload viejo mandaría un link muerto.
 *     El precio de esto es que `email_log` no es un archivo de lo que decía cada correo.
 *
 *  3) UN TIMEOUT NO SE REINTENTA. El workflow de n8n responde DESPUÉS de enviar (ver
 *     n8nClient.ts), así que un timeout es ambiguo: el correo pudo haberse ido. La fila
 *     se queda en 'pending' y solo la mira un humano. Que un correo se pierda es barato;
 *     que le llegue dos veces al cliente, no.
 */

import { supabaseAdmin } from '@/lib/supabase'
import { n8nConfirmedSuccess } from '@/lib/n8nClient'
import { sendSystemEmail } from '@/lib/emailTransport'

// ---------------------------------------------------------------------------
// Reglas transversales — aplican a TODOS los correos
// ---------------------------------------------------------------------------

/** Tope de correos no-campaña por persona dentro de la ventana de abajo. */
const FREQUENCY_CAP = 8
/**
 * "El ciclo de una mudanza" medido como 30 días rodantes por persona. Es una
 * aproximación deliberada: la alternativa era inventar una entidad "ciclo" en la base,
 * y esto funciona igual para alguien que re-cotiza tres veces en una semana.
 */
const FREQUENCY_WINDOW_DAYS = 30
/** Mínimo entre dos correos a la misma persona, para que no le lleguen en ráfaga. */
const MIN_GAP_HOURS = 20
/** Ventana de envío en hora de Chile. Fuera de esto no sale nada que no sea transaccional. */
const SEND_WINDOW_START_HOUR = 9
const SEND_WINDOW_END_HOUR = 21
/** Reintentos de un fallo definitivo de n8n (HTTP no-2xx) antes de rendirse. */
export const MAX_ATTEMPTS = 3
/**
 * Prefijo de los `email_type` de campaña. La campaña mensual NO cuenta contra el tope
 * de 8: la regla acordada es "8 por ciclo de mudanza MÁS 1 campaña al mes". Si en la
 * Fase 5 se nombran los tipos de campaña de otra forma, hay que cambiarlo acá o la
 * campaña se empezará a comer el cupo de los correos operacionales.
 */
const CAMPAIGN_TYPE_PREFIX = 'campaign'

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type EmailLogStatus = 'pending' | 'sent' | 'failed' | 'skipped'

export type SkipReason =
  /** La persona ya pagó o reservó: la secuencia se corta. */
  | 'converted'
  /** Un paso posterior de la misma secuencia reemplazó a este. */
  | 'superseded'
  | 'freq_cap'
  | 'min_gap'
  /** La entidad quedó demasiado vieja para que el correo tenga sentido. */
  | 'stale'
  /** El precheck del llamador lo rechazó por una razón propia de esa regla. */
  | 'precheck'

export type SendOutcome =
  /** Enviado y registrado. */
  | { outcome: 'sent'; id: string }
  /** Ya existía una fila resuelta para esta clave: no se hizo nada. */
  | { outcome: 'duplicate'; status: EmailLogStatus }
  /** No se envió por una regla de negocio. Queda registrado con su motivo. */
  | { outcome: 'skipped'; id: string; reason: SkipReason }
  /** n8n respondió un error definitivo. Se reintenta en la próxima pasada del cron. */
  | { outcome: 'failed'; id: string; error: string; attempts: number }
  /** Timeout o error de red: NO se sabe si el correo salió. La fila queda 'pending'. */
  | { outcome: 'unknown'; id: string; error: string }
  /** Bloqueado por el entorno (pausa, dry-run, lista blanca, ventana). No consume la clave. */
  | {
      outcome: 'deferred'
      reason: 'paused' | 'dry_run' | 'not_allowlisted' | 'quiet_hours' | 'no_recipient'
    }

export interface ClaimAndSendInput {
  /** Tipo + paso, p. ej. '06_payment_due_24h'. */
  emailType: string
  /** Se normaliza acá: el llamador puede pasar el email tal como está en la base. */
  recipient: string | null | undefined
  /** Usar bookingScope() / personScope() / monthScope(), no armarlo a mano. */
  scopeKey: string
  /** Cuándo se volvió exigible. Sirve para auditar el retraso del cron. */
  scheduledFor: Date | string
  bookingId?: string | null
  prospectId?: string | null
  /**
   * Lo que recibe n8n. Debe traer `event`, que es por donde discrimina su Switch.
   *
   * Se admite una función porque armar el payload puede costar caro y tener efectos:
   * el `#06` emite una orden de pago NUEVA en Flow (los links caducan, y `flow_token`
   * está vacío en todas las impagas). Si el payload se construyera antes de reclamar
   * la clave, cada barrido dejaría órdenes huérfanas en Flow por correos que ni se
   * mandan. La función se resuelve recién cuando el envío ya está decidido.
   */
  payload: Record<string, unknown> | (() => Promise<Record<string, unknown>>)
  /**
   * Última revalidación, ya con la clave reclamada y justo antes de postear a n8n.
   * Acá va el "¿seguirá impaga esta reserva?": cubre el caso de que el pago entre
   * entre que el cron eligió al candidato y el momento de enviar.
   */
  precheck?: () => Promise<SkipReason | null>
  /**
   * Correos que el cliente necesita sí o sí (comprobante de pago, pago rechazado).
   * Se saltan el tope de frecuencia y la ventana horaria: no se le esconde a alguien
   * el comprobante de lo que acaba de pagar porque son las 23:00 o porque ya iba 8.
   */
  transactional?: boolean
}

// ---------------------------------------------------------------------------
// Utilidades públicas
// ---------------------------------------------------------------------------

/**
 * La identidad de una PERSONA en todo el sistema de correos. `bookings.client_email`
 * tiene direcciones en mayúsculas, así que sin esto el dedup y el tope de frecuencia
 * tratarían a WALDO@X.CL y waldo@x.cl como dos personas distintas.
 */
export function normalizeEmail(raw: string | null | undefined): string {
  return typeof raw === 'string' ? raw.trim().toLowerCase() : ''
}

/** Scope de los correos del ciclo de UNA reserva (#05 #06 #07 #08 #09 #10). */
export function bookingScope(bookingId: string): string {
  return `bk:${bookingId}`
}

/**
 * Scope de la secuencia de cotización (#01-#04): se cuenta por PERSONA, no por fila
 * de `quote_prospects`. Por eso alguien que re-cotiza continúa donde iba en vez de
 * volver a empezar. `cycle` permite que la secuencia arranque de nuevo mucho después.
 */
export function personScope(email: string, cycle = 1): string {
  return `pe:${normalizeEmail(email)}:${cycle}`
}

/** Scope de la campaña mensual: una por persona y por mes. */
export function monthScope(yearMonth: string): string {
  return `mo:${yearMonth}`
}

/**
 * Scope del link de acceso al Panel del Cliente: uno por link pedido. Cada pedido es un
 * correo distinto (otro link, otro vencimiento), así que la clave no puede repetirse
 * entre pedidos de la misma persona o el segundo saldría como 'duplicate'.
 */
export function loginScope(tokenId: string): string {
  return `lg:${tokenId}`
}

/**
 * Hora del día (0-23) en Chile, que es donde está el cliente.
 *
 * El `% 24` no sobra: según la versión de ICU, `hour12:false` puede devolver "24"
 * para la medianoche en vez de "00". Sin eso, a las 00:xx la ventana de envío daría
 * por buena una hora fuera de rango y saldrían correos de madrugada.
 */
export function chileHour(date: Date = new Date()): number {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'America/Santiago',
      hour: '2-digit',
      hour12: false,
    }).format(date)
  )
  return Number.isFinite(hour) ? hour % 24 : 0
}

/** ¿Estamos en horario decente para escribirle a un cliente? */
export function isWithinSendWindow(date: Date = new Date()): boolean {
  const hour = chileHour(date)
  return hour >= SEND_WINDOW_START_HOUR && hour < SEND_WINDOW_END_HOUR
}

/**
 * Estado efectivo de las puertas de envío, para diagnosticar desde afuera.
 *
 * No expone valores, solo si están puestas: alcanza para saber por qué no salió un
 * correo sin tener que leer las variables de entorno de Vercel, que es justo lo que
 * no se puede hacer cuando el proyecto vive en la cuenta de otro.
 */
export function emailGatesStatus(): Record<string, unknown> {
  const allowlist = (process.env.EMAIL_ALLOWLIST || '').split(',').map(normalizeEmail).filter(Boolean)
  return {
    // Encendido por defecto: solo EMAIL_PAUSED lo detiene.
    paused: process.env.EMAIL_PAUSED === '1' || process.env.EMAIL_PAUSED === 'true',
    dry_run: process.env.EMAIL_DRY_RUN === '1' || process.env.EMAIL_DRY_RUN === 'true',
    allowlist_size: allowlist.length,
    recovery_enabled: process.env.EMAIL_RECOVERY_ENABLED === '1',
    within_send_window: isWithinSendWindow(),
    chile_hour: chileHour(),
  }
}

/** Correos efectivamente enviados en un mes 'AAAA-MM'. Define el tramo del fee. */
export async function countSentInMonth(yearMonth: string): Promise<number> {
  const from = `${yearMonth}-01T00:00:00Z`
  const to = new Date(Date.UTC(Number(yearMonth.slice(0, 4)), Number(yearMonth.slice(5, 7)), 1))
  const { count, error } = await supabaseAdmin
    .from('email_log')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'sent')
    .gte('sent_at', from)
    .lt('sent_at', to.toISOString())

  if (error) {
    console.error('[emailLog] Error contando envíos del mes:', error)
    return 0
  }
  return count || 0
}

/**
 * Marca un paso como reemplazado por otro posterior de la misma secuencia. Lo usa el
 * cron cuando una reserva lleva días impaga: sin esto, el primer barrido dispararía
 * el +2h, el +24h y el +72h de una sola vez sobre la misma persona.
 */
export async function markSuperseded(
  emailType: string,
  recipient: string,
  scopeKey: string,
  scheduledFor: Date | string
): Promise<void> {
  const to = normalizeEmail(recipient)
  if (!to) return

  const { error } = await supabaseAdmin.from('email_log').upsert(
    {
      email_type: emailType,
      recipient: to,
      scope_key: scopeKey,
      scheduled_for: toIso(scheduledFor),
      status: 'skipped',
      skip_reason: 'superseded' satisfies SkipReason,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'email_type,recipient,scope_key', ignoreDuplicates: true }
  )

  if (error) console.error(`[emailLog] Error marcando ${emailType} como superseded:`, error)
}

/** Clave de una fila de `email_log`, la misma de su índice único. */
export function emailLogKey(emailType: string, recipient: string, scopeKey: string): string {
  return `${emailType}|${normalizeEmail(recipient)}|${scopeKey}`
}

/**
 * Las claves de estos tipos que ya están resueltas: `claimAndSend` no haría nada con ellas
 * porque volverían como 'duplicate'. Solo una 'failed' con intentos disponibles queda fuera.
 *
 * Es una lectura para no hacer miles de llamadas por corrida (31-10-2026: la secuencia de
 * cotización hacía ~2.600 y cada corrida en horario de envío terminaba en 504 a los 300 s).
 * El candado sigue siendo el INSERT de `claimSlot`: una fila nueva que no alcance a salir
 * acá solo termina en un 'duplicate', como antes. Si la lectura falla devuelve lo que
 * alcanzó a leer, y lo que falte pasa por el camino lento.
 */
export async function readResolvedKeys(emailTypes: readonly string[]): Promise<Map<string, EmailLogStatus>> {
  const PAGE = 1000 // El tope de filas por respuesta de la API de Supabase.
  const resolved = new Map<string, EmailLogStatus>()
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from('email_log')
      .select('id, email_type, recipient, scope_key, status, attempts')
      .in('email_type', [...emailTypes])
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) {
      console.error('[emailLog] Error leyendo las claves resueltas:', error)
      return resolved
    }
    for (const row of data || []) {
      if (row.status === 'failed' && row.attempts < MAX_ATTEMPTS) continue
      resolved.set(emailLogKey(row.email_type, row.recipient, row.scope_key), row.status as EmailLogStatus)
    }
    if (!data || data.length === 0) return resolved
  }
}

// ---------------------------------------------------------------------------
// El núcleo
// ---------------------------------------------------------------------------

export async function claimAndSend(input: ClaimAndSendInput): Promise<SendOutcome> {
  const { emailType, scopeKey, payload, precheck, transactional = false } = input
  const recipient = normalizeEmail(input.recipient)
  const scheduledFor = toIso(input.scheduledFor)

  if (!recipient) {
    console.warn(`[emailLog][${emailType}] Sin destinatario: no se envía.`)
    return { outcome: 'deferred', reason: 'no_recipient' }
  }

  // --- Puertas de entorno ---------------------------------------------------
  // Se evalúan ANTES de reclamar la clave, a propósito: son condiciones del entorno,
  // no decisiones de negocio. Si consumieran la clave, un dry-run dejaría todas las
  // filas marcadas y después, con el envío real activado, no saldría ni un correo.
  const gate = environmentGate(recipient, transactional)
  if (gate) {
    console.info(`[emailLog][${emailType}] Diferido (${gate}) para ${recipient}.`)
    return { outcome: 'deferred', reason: gate }
  }

  // --- 1. Reclamar la clave -------------------------------------------------
  const claim = await claimSlot({
    emailType,
    recipient,
    scopeKey,
    scheduledFor,
    bookingId: input.bookingId ?? null,
    prospectId: input.prospectId ?? null,
  })
  if (claim.kind === 'duplicate') return { outcome: 'duplicate', status: claim.status }
  if (claim.kind === 'error') {
    console.error(`[emailLog][${emailType}] No se pudo reclamar la fila:`, claim.error)
    return { outcome: 'deferred', reason: 'no_recipient' }
  }
  const { id, attempts } = claim

  // --- 2. Reglas transversales ----------------------------------------------
  if (!transactional) {
    const violation = await checkFrequencyRules(recipient)
    if (violation) return finalizeSkipped(id, violation, emailType, recipient)
  }

  // --- 3. Revalidar la entidad ----------------------------------------------
  // Entre que el cron eligió al candidato y este instante pudo entrar el pago.
  if (precheck) {
    const reason = await precheck()
    if (reason) return finalizeSkipped(id, reason, emailType, recipient)
  }

  // --- 4. Enviar ------------------------------------------------------------
  // Recién acá se arma el payload: ya está decidido que este correo sale, así que
  // la orden de Flow que emita el #06 corresponde a un envío real y no queda huérfana.
  let body: Record<string, unknown>
  try {
    body = typeof payload === 'function' ? await payload() : payload
  } catch (e) {
    const error = `no se pudo armar el payload: ${e instanceof Error ? e.message : String(e)}`
    await update(id, { status: 'failed', error })
    console.error(`[emailLog][${emailType}] ${error}`)
    return { outcome: 'failed', id, error, attempts }
  }

  if (typeof body.event !== 'string' || !body.event) {
    const error = `el payload de ${emailType} no trae 'event'`
    await update(id, { status: 'failed', error })
    console.error(`[emailLog] ${error}`)
    return { outcome: 'failed', id, error, attempts }
  }

  // Directo por Resend si hay RESEND_API_KEY; si no, por n8n (emailTransport.ts). La clave
  // de idempotencia ata el envío a ESTA fila y ESTE intento: un doble disparo no duplica.
  const result = await sendSystemEmail(body, { label: emailType, idempotencyKey: `email-log/${id}/${attempts}` })

  // --- 5. Registrar el desenlace --------------------------------------------
  // Solo cuenta como enviado si n8n lo CONFIRMÓ con `{"success": true}`. Un 2xx a
  // secas no sirve: comprobado contra el webhook real, cuando el workflow muere a
  // mitad de camino n8n responde HTTP 200 con el cuerpo vacío. Dar eso por enviado
  // quemaría la clave de idempotencia y ese cliente no recibiría el correo nunca.
  if (n8nConfirmedSuccess(result)) {
    await update(id, { status: 'sent', sent_at: new Date().toISOString(), error: null })
    console.info(`[emailLog][${emailType}] Enviado a ${recipient}.`)
    return { outcome: 'sent', id }
  }

  // 2xx sin confirmación: el workflow falló adentro. n8n contestó, así que sabemos
  // que el correo NO salió — es reintentable, igual que un HTTP de error.
  if (result.ok) {
    const error = `n8n respondió ${result.status} sin "success": el workflow falló a mitad de camino`
    await update(id, { status: 'failed', error })
    console.error(`[emailLog][${emailType}] ${error} (intento ${attempts}/${MAX_ATTEMPTS})`)
    return { outcome: 'failed', id, error, attempts }
  }

  const error = result.error || 'error desconocido de n8n'

  // HTTP no-2xx: n8n contestó, o sea que llegó a decidir y no envió. Reintentable.
  if (typeof result.status === 'number') {
    await update(id, { status: 'failed', error })
    console.error(`[emailLog][${emailType}] Fallo definitivo (intento ${attempts}/${MAX_ATTEMPTS}): ${error}`)
    return { outcome: 'failed', id, error, attempts }
  }

  // Timeout o red: AMBIGUO. La fila se queda en 'pending' y nadie la reintenta sola.
  // Sale en el digest diario (Fase 4) para que la revise una persona.
  await update(id, { error })
  console.error(`[emailLog][${emailType}] Resultado AMBIGUO, queda en pending para revisión: ${error}`)
  return { outcome: 'unknown', id, error }
}

// ---------------------------------------------------------------------------
// Internos
// ---------------------------------------------------------------------------

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

/**
 * Puertas de entorno para que una sesión de desarrollo no le escriba a clientes reales.
 * `EMAIL_DRY_RUN=1` no manda nada; `EMAIL_ALLOWLIST` limita los destinatarios posibles.
 * Ojo con Flow: `.env.local` apunta al sandbox, así que un link generado en desarrollo
 * no sirve para pagar de verdad — razón de más para no dejar que salga.
 */
function environmentGate(
  recipient: string,
  transactional: boolean
): 'paused' | 'dry_run' | 'not_allowlisted' | 'quiet_hours' | null {
  // ENCENDIDO POR DEFECTO, y se apaga con EMAIL_PAUSED=1.
  //
  // Antes era al revés: hacía falta EMAIL_SENDING_ENABLED=1 para que saliera algo.
  // Ese fail-safe existía por un motivo concreto — mientras el workflow de n8n no
  // tuviera las ramas de estos `event`, su fallback respondía {success:true} SIN
  // enviar, así que un deploy prematuro habría marcado todo como 'sent' y quemado
  // claves de idempotencia que no se reintentan. **Ese riesgo ya no existe**: desde
  // el 2026-08-12 un correo solo cuenta como enviado si n8n confirma con
  // {"success": true}, y el fallback devuelve 422.
  //
  // Lo que sí quedó demostrado es el costo del otro lado: el proyecto de Vercel vive
  // en la cuenta del cliente, la variable nunca llegó, y el sistema pasó cinco días
  // apagado viendo desfilar pre-reservas impagas que después se borraban solas. Un
  // interruptor que solo se puede accionar desde donde no tenés acceso no es una
  // protección, es un punto único de falla.
  if (process.env.EMAIL_PAUSED === '1' || process.env.EMAIL_PAUSED === 'true') return 'paused'
  if (process.env.EMAIL_DRY_RUN === '1' || process.env.EMAIL_DRY_RUN === 'true') return 'dry_run'

  const allowlist = (process.env.EMAIL_ALLOWLIST || '')
    .split(',')
    .map(normalizeEmail)
    .filter(Boolean)
  if (allowlist.length > 0 && !allowlist.includes(recipient)) return 'not_allowlisted'

  if (!transactional && !isWithinSendWindow()) return 'quiet_hours'

  return null
}

type ClaimResult =
  | { kind: 'claimed'; id: string; attempts: number }
  | { kind: 'duplicate'; status: EmailLogStatus }
  | { kind: 'error'; error: unknown }

/**
 * Reclama el derecho a enviar este correo. El INSERT es atómico contra la clave única,
 * así que dos crons simultáneos no pueden reclamar el mismo.
 *
 * Si la clave ya existe, la única fila que se puede retomar es una 'failed' con
 * intentos disponibles — y el UPDATE lleva `.eq('status','failed')` para que, si otro
 * proceso la retomó primero, este se quede sin nada en vez de duplicar el envío.
 */
async function claimSlot(row: {
  emailType: string
  recipient: string
  scopeKey: string
  scheduledFor: string
  bookingId: string | null
  prospectId: string | null
}): Promise<ClaimResult> {
  const { data, error } = await supabaseAdmin
    .from('email_log')
    .insert({
      email_type: row.emailType,
      recipient: row.recipient,
      scope_key: row.scopeKey,
      scheduled_for: row.scheduledFor,
      booking_id: row.bookingId,
      prospect_id: row.prospectId,
      status: 'pending',
      attempts: 1,
    })
    .select('id')
    .single()

  if (!error && data) return { kind: 'claimed', id: data.id, attempts: 1 }

  // 23505 = unique_violation. Cualquier otro error es un problema real de base.
  if (error?.code !== '23505') return { kind: 'error', error }

  const { data: existing, error: findError } = await supabaseAdmin
    .from('email_log')
    .select('id, status, attempts')
    .eq('email_type', row.emailType)
    .eq('recipient', row.recipient)
    .eq('scope_key', row.scopeKey)
    .single()

  if (findError || !existing) return { kind: 'error', error: findError }
  if (existing.status !== 'failed' || existing.attempts >= MAX_ATTEMPTS) {
    return { kind: 'duplicate', status: existing.status as EmailLogStatus }
  }

  const attempts = existing.attempts + 1
  const { data: retaken, error: retakeError } = await supabaseAdmin
    .from('email_log')
    .update({ status: 'pending', attempts, updated_at: new Date().toISOString() })
    .eq('id', existing.id)
    .eq('status', 'failed')
    .select('id')
    .maybeSingle()

  if (retakeError) return { kind: 'error', error: retakeError }
  if (!retaken) return { kind: 'duplicate', status: 'pending' }

  return { kind: 'claimed', id: retaken.id, attempts }
}

/**
 * Tope de frecuencia y gap mínimo, contra lo efectivamente enviado.
 *
 * Un correo saltado por estas reglas queda saltado para siempre: la clave ya está
 * consumida y no se vuelve a evaluar. Es a propósito — los pasos de una secuencia
 * pierden sentido si llegan tarde, y así el log queda como cuenta completa de cada
 * decisión en vez de dejar huecos invisibles.
 */
async function checkFrequencyRules(recipient: string): Promise<SkipReason | null> {
  const windowStart = new Date(
    Date.now() - FREQUENCY_WINDOW_DAYS * 24 * 60 * 60 * 1000
  ).toISOString()

  // Solo cuenta lo que EFECTIVAMENTE salió ('sent'), no lo reclamado: la fila que
  // acabamos de reclamar está en 'pending', así que no puede contarse a sí misma.
  const { data, error } = await supabaseAdmin
    .from('email_log')
    .select('sent_at')
    .eq('recipient', recipient)
    .eq('status', 'sent')
    .not('email_type', 'like', `${CAMPAIGN_TYPE_PREFIX}%`)
    .gte('sent_at', windowStart)
    .order('sent_at', { ascending: false })

  if (error) {
    // Ante la duda no bloqueamos: es peor no mandar un correo operacional por un
    // fallo de lectura que mandar uno de más.
    console.error('[emailLog] Error evaluando el tope de frecuencia:', error)
    return null
  }

  const sent = data || []
  if (sent.length >= FREQUENCY_CAP) return 'freq_cap'

  const last = sent[0]?.sent_at
  if (last && Date.now() - new Date(last).getTime() < MIN_GAP_HOURS * 60 * 60 * 1000) {
    return 'min_gap'
  }

  return null
}

async function finalizeSkipped(
  id: string,
  reason: SkipReason,
  emailType: string,
  recipient: string
): Promise<SendOutcome> {
  await update(id, { status: 'skipped', skip_reason: reason })
  console.info(`[emailLog][${emailType}] Saltado (${reason}) para ${recipient}.`)
  return { outcome: 'skipped', id, reason }
}

async function update(id: string, fields: Record<string, unknown>): Promise<void> {
  const { error } = await supabaseAdmin
    .from('email_log')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', id)

  if (error) console.error(`[emailLog] Error actualizando la fila ${id}:`, error)
}
