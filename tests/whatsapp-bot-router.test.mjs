import test from 'node:test'
import assert from 'node:assert/strict'
import {
  botCommand,
  decideBotAction,
  isQuoteExpired,
  QUOTE_IDLE_TIMEOUT_MS,
  QUOTE_MAX_DURATION_MS,
  MENU_IDLE_RESET_MS,
} from '../src/lib/whatsapp/botRouter.ts'

const START = Date.parse('2026-10-28T15:00:00.000Z')
function state({ mode = 'quoting', last = START, started = START, greeted = true } = {}) {
  return {
    phone: '+56911112222',
    mode,
    quote_session_id: mode === 'quoting' ? 'test-quote' : null,
    activated_at: started === null ? null : new Date(started).toISOString(),
    last_activity_at: last === null ? null : new Date(last).toISOString(),
    greeted_at: greeted ? new Date(START).toISOString() : null,
    updated_at: new Date(START).toISOString(),
  }
}

test('solo la palabra exacta activa una cotización', () => {
  assert.equal(botCommand('COTIZAR'), 'COTIZAR')
  assert.equal(botCommand(' cotizar '), 'COTIZAR')
  assert.equal(botCommand('quiero cotizar'), null)
  assert.equal(decideBotAction('quiero cotizar', state({ mode: 'idle' }), START), 'silent')
})

test('el primer mensaje muestra siempre el menú, incluso si es COTIZAR', () => {
  assert.equal(decideBotAction('hola', null, START), 'welcome')
  assert.equal(decideBotAction('COTIZAR', null, START), 'welcome')
  assert.equal(decideBotAction('COTIZAR', state({ mode: 'idle', greeted: false }), START), 'welcome')
  assert.equal(decideBotAction('COTIZAR', state({ mode: 'idle' }), START), 'start_quote')
})

test('modo idle: tras cinco minutos un COTIZAR explícito retoma sin obligar al menú', () => {
  const idle = state({ mode: 'idle' })
  assert.equal(decideBotAction('COTIZAR', idle, START + MENU_IDLE_RESET_MS - 1), 'start_quote')
  assert.equal(decideBotAction('COTIZAR', idle, START + MENU_IDLE_RESET_MS), 'start_quote')
  assert.equal(decideBotAction('hola', idle, START + MENU_IDLE_RESET_MS), 'welcome')
  assert.equal(decideBotAction('gracias', idle, START + MENU_IDLE_RESET_MS - 1), 'silent')
})

test('cotización disponible por 24 h de actividad, reanudable cuando expira', () => {
  const current = state()
  assert.equal(decideBotAction('cama', current, START + QUOTE_IDLE_TIMEOUT_MS - 1), 'quote_message')
  assert.equal(decideBotAction('cama', current, START + QUOTE_IDLE_TIMEOUT_MS), 'expire_silent')
  // Un comando explícito permite reautorizar la sesión conservada.
  assert.equal(decideBotAction('COTIZAR', current, START + QUOTE_IDLE_TIMEOUT_MS), 'start_quote')
  assert.equal(decideBotAction('Quiero retomar la conversación', current, START + QUOTE_IDLE_TIMEOUT_MS), 'start_quote')
})

test('una sesión antigua no caduca mientras el cliente esté activo', () => {
  const current = state({ last: START + QUOTE_MAX_DURATION_MS - 2_000 })
  assert.equal(decideBotAction('respuesta', current, START + QUOTE_MAX_DURATION_MS), 'quote_message')
})

test('el usuario puede SALIR, pedir ASESOR o MENU aun con sesión caducada', () => {
  const current = state()
  assert.equal(decideBotAction('SALIR', current, START + QUOTE_IDLE_TIMEOUT_MS), 'exit')
  assert.equal(decideBotAction('ASESOR', current, START + QUOTE_IDLE_TIMEOUT_MS), 'human')
  assert.equal(decideBotAction('MENU', current, START + QUOTE_IDLE_TIMEOUT_MS), 'menu')
})

test('el modo humano no responde automáticamente salvo comandos explícitos', () => {
  const human = state({ mode: 'human' })
  assert.equal(decideBotAction('hola', human, START + 999999999), 'silent')
  assert.equal(decideBotAction('ASESOR', human, START), 'human')
  assert.equal(decideBotAction('COTIZAR', human, START), 'start_quote')
  assert.equal(decideBotAction('SALIR', human, START), 'exit')
  assert.equal(decideBotAction('MENU', human, START), 'menu')
})

test('fechas inválidas o ausentes desactivan OpenAI por seguridad', () => {
  assert.equal(isQuoteExpired(state({ started: null }), START + 1), false) // La antigüedad no borra la cotización
  assert.equal(isQuoteExpired(state({ last: null })), true)
})

test('menú inicial no ofrece SALIR y RETOMAR no pierde la sesión', () => {
  assert.equal(botCommand('RETOMAR'), 'RETOMAR')
  assert.equal(botCommand('NUEVA COTIZACIÓN'), 'NUEVA')
  assert.equal(decideBotAction('RETOMAR', state({ mode: 'idle' }), START), 'start_quote')
})
