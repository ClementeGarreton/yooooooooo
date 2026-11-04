import { supabaseAdmin } from '@/lib/supabase'
import { MENU_IDLE_RESET_MS, type BotMode, type WhatsAppBotState } from '@/lib/whatsapp/botRouter'

/**
 * Enrutador sin migraciones. Utiliza ai_conversations y quote_sessions,
 * que ya forman parte del cotizador en producción.
 *
 * El marcador identifica EXCLUSIVAMENTE estados creados por esta versión:
 * ninguna sesión antigua de cotización puede habilitar OpenAI.
 */
const ROUTER_PENDING = 'whatsapp-router-v1-pending'
const ROUTER_READY = 'whatsapp-router-v1-ready'

type RouterRow = {
  id: string
  model: string | null
  status: string
  quote_session_id: string | null
  last_message_at: string
  created_at: string
  updated_at: string
}

async function findRouter(phone: string): Promise<RouterRow | null> {
  const { data, error } = await supabaseAdmin
    .from('ai_conversations')
    .select('id,model,status,quote_session_id,last_message_at,created_at,updated_at')
    .eq('channel', 'whatsapp')
    .eq('external_user_id', phone)
    .in('model', [ROUTER_PENDING, ROUTER_READY])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`No se pudo consultar el enrutador de WhatsApp: ${error.message}`)
  return (data as RouterRow | null) || null
}

async function ensureRouter(phone: string): Promise<RouterRow> {
  const current = await findRouter(phone)
  if (current) return current

  // Se crea SOLO el registro de control, no una cotización ni una llamada a IA.
  const { data, error } = await supabaseAdmin
    .from('ai_conversations')
    .insert({
      channel: 'whatsapp',
      external_user_id: phone,
      model: ROUTER_PENDING,
      status: 'closed',
      quote_session_id: null,
    })
    .select('id,model,status,quote_session_id,last_message_at,created_at,updated_at')
    .single()
  if (error || !data) throw new Error(`No se pudo iniciar el enrutador de WhatsApp: ${error?.message || 'sin datos'}`)
  return data as RouterRow
}

/** Devuelve el estado de autorización, sin inferirlo de sesiones heredadas. */
export async function ensureBotState(phone: string): Promise<WhatsAppBotState> {
  const router = await ensureRouter(phone)
  let mode: BotMode = router.status === 'handoff' ? 'human' : 'idle'
  let activatedAt: string | null = null
  let quoteSessionId: string | null = null

  if (router.model === ROUTER_READY && router.status === 'active' && router.quote_session_id) {
    const { data: quote, error } = await supabaseAdmin
      .from('quote_sessions')
      .select('id,status,channel,phone,created_at')
      .eq('id', router.quote_session_id)
      .eq('channel', 'whatsapp')
      .eq('phone', phone)
      .maybeSingle()
    if (error) throw new Error(`No se pudo comprobar la cotización activa: ${error.message}`)
    if (quote && ['collecting', 'ready'].includes(quote.status)) {
      mode = 'quoting'
      activatedAt = quote.created_at
      quoteSessionId = quote.id
    }
  }

  return {
    phone,
    mode,
    greeted_at: router.model === ROUTER_READY ? router.created_at : null,
    quote_session_id: quoteSessionId,
    activated_at: activatedAt,
    last_activity_at: router.last_message_at,
    updated_at: router.updated_at,
  }
}

/**
 * Idempotencia: aprovecha el índice UNIQUE ya existente en ai_messages.external_message_id.
 * Los mensajes sin cotización se almacenan en la conversación de control.
 */
export async function claimIncomingMessage(input: {
  phone: string
  messageId: string
  content: string
  messageType: 'text' | 'image' | 'interactive'
}): Promise<boolean> {
  const router = await ensureRouter(input.phone)
  const { error } = await supabaseAdmin.from('ai_messages').insert({
    conversation_id: router.id,
    direction: 'inbound',
    role: 'user',
    content: input.content,
    message_type: input.messageType,
    external_message_id: input.messageId,
    metadata: {},
  })
  if (error?.code === '23505') return false
  if (error) throw new Error(`No se pudo registrar el mensaje entrante: ${error.message}`)
  return true
}

/** Tras abrir una cotización, enlaza el mensaje recibido con su conversación de IA. */
export async function moveIncomingToConversation(messageId: string, conversationId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('ai_messages')
    .update({ conversation_id: conversationId })
    .eq('external_message_id', messageId)
  if (error) throw new Error(`No se pudo enlazar el mensaje de WhatsApp: ${error.message}`)
}

/** Reclama la bienvenida de forma atómica, tanto para nuevos contactos como
 * para una interacción inactiva. Actualiza el reloj para evitar repetirla. */
export async function claimFirstWelcome(phone: string, explicitGreeting = false): Promise<string | null> {
  const router = await ensureRouter(phone)
  const now = new Date().toISOString()
  const query = supabaseAdmin.from('ai_conversations')
    .update({ model: ROUTER_READY, last_message_at: now, updated_at: now })
    .eq('id', router.id)
  let result
  if (router.model === ROUTER_PENDING) {
    result = await query.eq('model', ROUTER_PENDING).select('id')
  } else if (router.model === ROUTER_READY && router.status === 'closed'
    && (explicitGreeting || !Number.isFinite(Date.parse(router.last_message_at))
      || Date.now() - Date.parse(router.last_message_at) >= MENU_IDLE_RESET_MS)) {
    result = await query.eq('model', ROUTER_READY).eq('status', 'closed')
      .eq('last_message_at', router.last_message_at).select('id')
  } else if (router.model === ROUTER_READY && router.status === 'active' && explicitGreeting) {
    // Una cotización cerrada o inexistente puede dejar una fila 'active' antigua.
    // Aquí solo se llega si ensureBotState la clasificó como idle; no se reabre IA.
    result = await supabaseAdmin.from('ai_conversations')
      .update({ model: ROUTER_READY, status: 'closed', quote_session_id: null,
        last_message_at: now, updated_at: now })
      .eq('id', router.id).eq('model', ROUTER_READY).eq('status', 'active')
      .eq('last_message_at', router.last_message_at).select('id')
  } else {
    return null
  }
  if (result.error) throw new Error(result.error.message)
  return result.data?.length ? now : null
}

/** Registra silencio pasivo para no repetir el menú en cada mensaje. */
export async function touchIdleActivity(phone: string): Promise<void> {
  const router = await ensureRouter(phone)
  if (router.model !== ROUTER_READY || router.status !== 'closed') return
  const { error } = await supabaseAdmin.from('ai_conversations')
    .update({ last_message_at: new Date().toISOString() })
    .eq('id', router.id).eq('model', ROUTER_READY).eq('status', 'closed')
  if (error) throw new Error(`No se pudo registrar actividad pasiva: ${error.message}`)
}

export async function releaseFailedWelcome(phone: string, claimAt: string): Promise<void> {
  const router = await findRouter(phone)
  if (!router) return
  const { error } = await supabaseAdmin
    .from('ai_conversations')
    .update({ model: ROUTER_PENDING })
    .eq('id', router.id)
    .eq('model', ROUTER_READY)
    .eq('updated_at', claimAt)
  if (error) throw new Error(error.message)
}

export async function setBotMode(phone: string, mode: BotMode, quoteSessionId: string | null = null): Promise<void> {
  const router = await ensureRouter(phone)
  const now = new Date().toISOString()
  const { error } = await supabaseAdmin
    .from('ai_conversations')
    .update({
      model: ROUTER_READY,
      status: mode === 'quoting' ? 'active' : mode === 'human' ? 'handoff' : 'closed',
      quote_session_id: mode === 'quoting' ? quoteSessionId : null,
      last_message_at: now,
      updated_at: now,
    })
    .eq('id', router.id)
  if (error) throw new Error(`No se pudo cambiar el estado del bot: ${error.message}`)
}

/** Solo se actualiza el reloj si COTIZAR sigue autorizado al recibir el mensaje. */
export async function refreshQuoteActivity(phone: string, quoteSessionId: string): Promise<boolean> {
  const router = await findRouter(phone)
  if (!router) return false
  const now = new Date().toISOString()
  const { data, error } = await supabaseAdmin
    .from('ai_conversations')
    .update({ last_message_at: now, updated_at: now })
    .eq('id', router.id)
    .eq('model', ROUTER_READY)
    .eq('status', 'active')
    .eq('quote_session_id', quoteSessionId)
    .select('id')
  if (error) throw new Error(error.message)
  return Boolean(data?.length)
}
