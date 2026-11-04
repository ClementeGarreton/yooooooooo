import { NextRequest, NextResponse } from 'next/server'
import { verifyWebhookSignature } from '@/lib/whatsapp/cloudApi'
import { messageContext } from '@/lib/whatsapp/messageTransport'
import { summarizeWhatsAppWebhook } from '@/lib/whatsapp/webhookDiagnostics'
import { extractMessages, processIncoming, notifyMessageProcessingError } from '@/lib/whatsapp/incomingProcessor'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get('hub.mode')
  const token = request.nextUrl.searchParams.get('hub.verify_token')
  const challenge = request.nextUrl.searchParams.get('hub.challenge')
  if (mode === 'subscribe' && token && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return new NextResponse(challenge || '', { status: 200 })
  }
  return new NextResponse('Forbidden', { status: 403 })
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text()
  if (!verifyWebhookSignature(rawBody, request.headers.get('x-hub-signature-256'))) {
    // Un GET 200 no demuestra que los POST estén autenticados.
    console.error('[WhatsApp webhook] POST rechazado por firma inválida o META_APP_SECRET ausente')
    return new NextResponse('Invalid signature', { status: 401 })
  }

  let payload: any
  try {
    payload = JSON.parse(rawBody)
  } catch {
    console.error('[WhatsApp webhook] POST firmado con JSON inválido')
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const allowed = [process.env.WHATSAPP_PHONE_NUMBER_ID, process.env.WHATSAPP_SECRETARY_PHONE_NUMBER_ID]
    .filter((id): id is string => Boolean(id))
  const summary = summarizeWhatsAppWebhook(payload, allowed)
  let messages: ReturnType<typeof extractMessages>
  try {
    messages = extractMessages(payload)
  } catch (error) {
    console.error('[WhatsApp webhook] Error interpretando evento:', error)
    return NextResponse.json({ error: 'Invalid webhook payload' }, { status: 400 })
  }
  // Logs seguros: identificadores de clientes, contenido y credenciales no se registran.
  if (summary.incomingMessages || summary.statusUpdates) {
    console.info('[WhatsApp webhook] Evento recibido:', JSON.stringify({
      ...summary, extracted: messages.length, configuredPhoneIds: allowed.length,
    }))
  }
  if (summary.ignoredPhoneMessages) {
    console.warn('[WhatsApp webhook] Se descartaron mensajes por phone_number_id no autorizado')
  }
  if (messages.length !== summary.matchedMessages) {
    console.warn('[WhatsApp webhook] Parte de los mensajes admitidos no pasó la validación estructural')
  }
  for (const message of messages) {
    try {
      await messageContext.run({ platform: 'whatsapp', businessPhoneId: message.businessPhoneId! }, async () => {
        try { await processIncoming(message) }
        catch (error) { console.error('[WhatsApp webhook] Error procesando mensaje:', error); await notifyMessageProcessingError(message) }
      })
    } catch (error) { console.error('[WhatsApp webhook] Error de contexto:', error) }
  }

  return NextResponse.json({ ok: true })
}
