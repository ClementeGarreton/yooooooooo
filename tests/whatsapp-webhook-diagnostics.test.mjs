import test from 'node:test'
import assert from 'node:assert/strict'
import { summarizeWhatsAppWebhook } from '../src/lib/whatsapp/webhookDiagnostics.ts'
import { decideBotAction, isGreeting } from '../src/lib/whatsapp/botRouter.ts'

const date = new Date('2026-11-04T14:00:00Z').toISOString()
const idle = { phone: '+56911112222', mode: 'idle', greeted_at: date,
  quote_session_id: null, activated_at: null, last_activity_at: date, updated_at: date }

test('un saludo explícito no permanece silencioso por estados de antes del cambio de número', () => {
  assert.equal(isGreeting('¡hola!'), true)
  assert.equal(isGreeting('HOLA!'), true)
  assert.equal(decideBotAction('hola', idle, Date.parse(date) + 1000), 'welcome')
  assert.equal(decideBotAction('gracias', idle, Date.parse(date) + 1000), 'silent')
})

test('cuenta mensajes de números permitidos sin registrar datos personales', () => {
  const payload = { entry: [{ changes: [
    { value: { metadata: { phone_number_id: '1476949085492636' }, messages: [{ id: 'A', from: '5691111' }] } },
    { value: { metadata: { phone_number_id: 'old' }, messages: [{ id: 'B', from: '5692222' }] } },
    { value: { statuses: [{ id: 'delivered' }], metadata: { phone_number_id: '1476949085492636' } } },
  ] }] }
  assert.deepEqual(summarizeWhatsAppWebhook(payload, ['1476949085492636']), {
    changes: 3, incomingMessages: 2, matchedMessages: 1, ignoredPhoneMessages: 1, statusUpdates: 1,
  })
})

test('payload inválido no genera contadores falsos', () => {
  assert.deepEqual(summarizeWhatsAppWebhook({ entry: { bogus: true } }, ['123']), {
    changes: 0, incomingMessages: 0, matchedMessages: 0, ignoredPhoneMessages: 0, statusUpdates: 0,
  })
})
