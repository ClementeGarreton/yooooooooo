/**
 * Enrutador determinista: jamás llama a OpenAI ni interpreta texto libre.
 * Una sesión antigua de quote_sessions NO autoriza la ejecución del bot.
 */
export const QUOTE_IDLE_TIMEOUT_MS = 24 * 60 * 60 * 1000
export const QUOTE_MAX_DURATION_MS = 7 * 24 * 60 * 60 * 1000
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

export type BotCommand = 'COTIZAR' | 'RETOMAR' | 'NUEVA' | 'ASESOR' | 'RECLAMO' | 'SEGUIMIENTO' | 'TRABAJO' | 'MENU' | 'SALIR' | null
export type BotDecision =
  | 'start_quote'
  | 'start_new_quote'
  | 'human'
  | 'menu'
  | 'exit'
  | 'welcome'
  | 'quote_message'
  | 'expire_silent'
  | 'silent'

import { TOMMY_WELCOME } from './tommyFlow.ts'
export const WHATSAPP_WELCOME = TOMMY_WELCOME

/** Un saludo explícito en modo idle debe recibir respuesta, aunque existan
 * mensajes anteriores: nunca prolongar un silencio indefinidamente con 'hola'. */
export function isGreeting(text: string): boolean {
  return /^¡*(hola|holi|buenas|buenos d[ií]as|buenas tardes|buenas noches|hey|ola)[!.\s]*$/i.test(text.trim())
}

export function botCommand(text: string): BotCommand {
  // Solo la palabra aislada; "quiero cotizar" NO inicia OpenAI.
  const value = text.trim().toLocaleUpperCase('es')
  if (value === 'COTIZAR' || value === '1' || value === '1)') return 'COTIZAR'
  if (/^(RETOMAR|CONTINUAR|QUIERO RETOMAR(?: LA CONVERSACI[OÓ]N)?|SEGUIR COTIZANDO)$/.test(value)) return 'RETOMAR'
  if (/^(NUEVA|NUEVA COTIZACI[OÓ]N|EMPEZAR DE CERO)$/.test(value)) return 'NUEVA'
  if (value === 'ASESOR' || value === 'EJECUTIVO' || value === '3' || value === '3)' || value.startsWith('PROVEEDORES,') || value === 'SOLICITUDES ESPECIALES') return 'ASESOR'
  if (value === 'RECLAMO' || value === 'QUEJA') return 'RECLAMO'
  if (/^(2|2[)]|SEGUIMIENTO|SEGUIMIENTO DE UN SERVICIO|SEGUIMIENTO DE SERVICIO|SEGUIMIENTO DE COTIZACI[OÓ]N|ESTADO DE COTIZACI[OÓ]N)$/.test(value)) return 'SEGUIMIENTO'
  if (/^(TRABAJO|TRABAJO EN CURSO|SERVICIO EN CURSO)$/.test(value)) return 'TRABAJO'
  if (value === 'MENU' || value === 'MENÚ') return 'MENU'
  if (value === 'SALIR') return 'SALIR'
  return null
}

export function isQuoteExpired(state: WhatsAppBotState, now = Date.now()): boolean {
  if (state.mode !== 'quoting') return false
  const last = state.last_activity_at ? Date.parse(state.last_activity_at) : NaN
  // La autorización vence por inactividad; la sesión NO se borra y puede retomarse.
  return !Number.isFinite(last) || now - last >= QUOTE_IDLE_TIMEOUT_MS
}

/**
 * La bienvenida precede a la primera autorización de COTIZAR.
 * Después de cinco minutos sin interacción en modo idle vuelve a mostrarse
 * el menú antes de aceptar una cotización nueva. En atención humana
 * permanece el silencio, salvo que el cliente escriba un comando explícito.
 */
export function decideBotAction(text: string, state: WhatsAppBotState | null, now = Date.now()): BotDecision {
  // Dentro de la cotización, «1», «2» o «3» son respuestas, no órdenes del menú.
  const command = state?.mode === 'quoting' && /^\s*[123]\)?\s*$/.test(text) ? null : botCommand(text)
  if (!state?.greeted_at) return 'welcome'
  // Los controles explícitos siguen disponibles incluso tras una expiración.
  if (command === 'SALIR') return 'exit'
  if (['ASESOR', 'RECLAMO', 'SEGUIMIENTO', 'TRABAJO'].includes(command || '')) return 'human'
  if (command === 'MENU') return 'menu'
  if (command === 'NUEVA') return 'start_new_quote'
  if (command === 'RETOMAR' || command === 'COTIZAR') return 'start_quote'

  // Un mensaje a una cotización ya caducada NO puede reactivar la IA.
  if (state?.mode === 'quoting' && isQuoteExpired(state, now)) return 'expire_silent'

  // Tras la bienvenida, un mensaje libre como «necesito mudar 2 camas»
  // inicia cotización sin obligar al cliente a escribir COTIZAR.
  if (state.mode === 'idle') {
    if (isGreeting(text)) return 'welcome'
    return 'start_quote'
  }

  if (state.mode === 'quoting') return 'quote_message'
  return 'silent'
}
