/**
 * Enrutador determinista: jamás llama a OpenAI ni interpreta texto libre.
 * Una sesión antigua de quote_sessions NO autoriza la ejecución del bot.
 */
export const QUOTE_IDLE_TIMEOUT_MS = 5 * 60 * 1000
export const QUOTE_MAX_DURATION_MS = 15 * 60 * 1000
// Pasados 5 min sin interacción, una conversación inactiva vuelve al menú.
export const MENU_IDLE_RESET_MS = 5 * 60 * 1000

export type BotMode = 'idle' | 'quoting' | 'human'

export interface WhatsAppBotState {
  phone: string
  mode: BotMode
  greeted_at: string | null
  quote_session_id: string | null
  activated_at: string | null
  last_activity_at: string | null
  updated_at: string
}

export type BotCommand = 'COTIZAR' | 'ASESOR' | 'MENU' | 'SALIR' | null
export type BotDecision =
  | 'start_quote'
  | 'human'
  | 'menu'
  | 'exit'
  | 'welcome'
  | 'quote_message'
  | 'expire_silent'
  | 'silent'

export const WHATSAPP_WELCOME = [
  '¡Bienvenido a *Yo Me Encargo*! 👋',
  '',
  '¿Cómo podemos ayudarte? Escribe una de estas palabras:',
  '*COTIZAR* — Iniciar una cotización automática.',
  '*ASESOR* — Hablar con una persona (sin IA).',
  '*SALIR* — Finalizar la atención automática.',
].join('\n')

/** Un saludo explícito en modo idle debe recibir respuesta, aunque existan
 * mensajes anteriores: nunca prolongar un silencio indefinidamente con 'hola'. */
export function isGreeting(text: string): boolean {
  return /^¡*(hola|holi|buenas|buenos d[ií]as|buenas tardes|buenas noches|hey|ola)[!.\s]*$/i.test(text.trim())
}

export function botCommand(text: string): BotCommand {
  // Solo la palabra aislada; "quiero cotizar" NO inicia OpenAI.
  const value = text.trim().toLocaleUpperCase('es')
  if (value === 'COTIZAR') return 'COTIZAR'
  if (value === 'ASESOR' || value === 'EJECUTIVO') return 'ASESOR'
  if (value === 'MENU' || value === 'MENÚ') return 'MENU'
  if (value === 'SALIR') return 'SALIR'
  return null
}

export function isQuoteExpired(state: WhatsAppBotState, now = Date.now()): boolean {
  if (state.mode !== 'quoting') return false
  const started = state.activated_at ? Date.parse(state.activated_at) : NaN
  const last = state.last_activity_at ? Date.parse(state.last_activity_at) : NaN
  // Fail closed: no se permite OpenAI con fechas ausentes o corruptas.
  return !Number.isFinite(started)
    || !Number.isFinite(last)
    || now - last >= QUOTE_IDLE_TIMEOUT_MS
    || now - started >= QUOTE_MAX_DURATION_MS
}

/**
 * La bienvenida precede a la primera autorización de COTIZAR.
 * Después de cinco minutos sin interacción en modo idle vuelve a mostrarse
 * el menú antes de aceptar una cotización nueva. En atención humana
 * permanece el silencio, salvo que el cliente escriba un comando explícito.
 */
export function decideBotAction(text: string, state: WhatsAppBotState | null, now = Date.now()): BotDecision {
  const command = botCommand(text)
  // Los controles explícitos siguen disponibles incluso tras una expiración.
  if (command === 'SALIR') return 'exit'
  if (command === 'ASESOR') return 'human'
  if (command === 'MENU') return 'menu'

  // Un mensaje a una cotización ya caducada NO puede reactivar la IA.
  if (state?.mode === 'quoting' && isQuoteExpired(state, now)) return 'expire_silent'

  // Primero presenta opciones: nunca iniciar IA ante el primer mensaje,
  // aunque ese primer mensaje sea literalmente COTIZAR.
  if (!state?.greeted_at) return 'welcome'

  if (state.mode === 'idle') {
    if (isGreeting(text)) return 'welcome'
    const last = state.last_activity_at ? Date.parse(state.last_activity_at) : NaN
    if (!Number.isFinite(last) || now - last >= MENU_IDLE_RESET_MS) return 'welcome'
  }

  if (command === 'COTIZAR') return 'start_quote'
  if (state.mode === 'quoting') return 'quote_message'
  return 'silent'
}
