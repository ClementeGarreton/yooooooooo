import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const webhook = read('src/lib/whatsapp/incomingProcessor.ts')
const quote = read('src/lib/quoteSession.ts')
const pdf = read('src/lib/serverQuoteEngine.ts')

test('cotizaciones Whatsapp enlazan test97 y mantienen session + token', () => {
  assert.match(webhook, /yo-me-encargo-test97\.vercel\.app/)
  assert.match(webhook, /session=\$\{encodeURIComponent\(session\.id\)\}/)
  assert.match(webhook, /token=\$\{encodeURIComponent\(session\.resume_token\)\}/)
})
test('Flow conserva su pasarela y obtiene URL desde el sitio configurado', () => {
  const file = read('src/lib/quoteCheckout.ts')
  assert.match(file, /siteUrl\(\)/)
  assert.match(file, /flowService\.createPayment/)
})
test('guardar originales por ID de mensaje y persistir rutas en state', () => {
  assert.match(webhook, /saveQuotePhoto\(session\.id, message\.id, imageDataUrl\)/)
  assert.match(quote, /storagePath\?: string/)
  assert.match(read('src/lib/whatsapp/photoStorage.ts'), /storage\.from\('bookings'\)\.upload/)
})
test('PDF conserva metros de acarreo y fotos del inventario', () => {
  assert.match(pdf, /Acarreo en retiro:/)
  assert.match(pdf, /Acarreo en entrega:/)
  assert.match(pdf, /pdf\.addImage/)
})
test('documento fiscal se pregunta, sin recargo B2B fijo del 19%', () => {
  assert.match(quote, /Documento tributario/)
  assert.match(quote, /taxDocument/)
  assert.doesNotMatch(pdf, /price \*= 1\.19/)
})
test('secretaría no mezcla webhook ni respuesta con el número principal', () => {
  assert.match(webhook, /WHATSAPP_SECRETARY_PHONE_NUMBER_ID/)
  assert.match(read('src/lib/whatsapp/messageTransport.ts'), /businessPhoneId/)
})
test('Instagram se autentica y recibe mensajes del perfil indicado', () => {
  const route = read('src/app/api/instagram/webhook/route.ts')
  assert.match(route, /verifyWebhookSignature/)
  assert.match(route, /INSTAGRAM_ACCOUNT_ID/)
  assert.match(route, /processIncoming/)
  assert.match(read('src/lib/instagram/webhookPayload.ts'), /is_echo/)
})
test('menú visible simplificado, comandos antiguos preservados', () => {
  const menu = read('src/lib/whatsapp/botRouter.ts')
  assert.doesNotMatch(menu.split('export function botCommand')[0], /'\*MENU\* —/)
  assert.match(menu, /if \(value === 'MENU'/)
})
