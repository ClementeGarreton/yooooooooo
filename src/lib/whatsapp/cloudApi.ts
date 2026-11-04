import crypto from 'crypto'

const DEFAULT_GRAPH_VERSION = 'v26.0'

function config() {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID
  const graphVersion = process.env.WHATSAPP_GRAPH_VERSION || DEFAULT_GRAPH_VERSION
  if (!accessToken || !phoneNumberId) {
    throw new Error('WhatsApp Cloud API no está configurada')
  }
  return { accessToken, phoneNumberId, graphVersion }
}

function apiBase() {
  const { graphVersion } = config()
  return `https://graph.facebook.com/${graphVersion}`
}

async function graphFetch(path: string, init: RequestInit) {
  const { accessToken } = config()
  const response = await fetch(`${apiBase()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init.headers || {}),
    },
    signal: AbortSignal.timeout(25_000),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    const graphError = payload?.error
    // No mostrar URL completa, token, contenido del mensaje ni teléfono del cliente.
    const detail = [
      `HTTP ${response.status}`,
      graphError?.code != null ? `code=${graphError.code}` : null,
      graphError?.error_subcode != null ? `subcode=${graphError.error_subcode}` : null,
      graphError?.message || 'Error no especificado',
    ].filter(Boolean).join(' | ')
    throw new Error(`WhatsApp Graph API: ${detail}`)
  }
  return payload
}

export function isWhatsAppConfigured() {
  return Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID)
}

export function verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.META_APP_SECRET
  if (!secret) return process.env.NODE_ENV !== 'production'
  if (!signature?.startsWith('sha256=')) return false
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  } catch {
    return false
  }
}

export async function sendWhatsAppText(to: string, body: string, sendingPhoneId?: string) {
  const { phoneNumberId: primaryId } = config()
  const phoneNumberId = sendingPhoneId || primaryId
  return graphFetch(`/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { preview_url: false, body },
    }),
  })
}

export async function sendWhatsAppDocument(to: string, documentUrl: string, filename: string, caption?: string, sendingPhoneId?: string) {
  const { phoneNumberId: primaryId } = config()
  const phoneNumberId = sendingPhoneId || primaryId
  return graphFetch(`/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'document',
      document: {
        link: documentUrl,
        filename,
        ...(caption ? { caption } : {}),
      },
    }),
  })
}

export async function downloadWhatsAppMediaAsDataUrl(mediaId: string): Promise<string> {
  const metadata = await graphFetch(`/${mediaId}`, { method: 'GET' })
  if (!metadata?.url) throw new Error('Meta no devolvió URL para el medio')

  const { accessToken } = config()
  const response = await fetch(metadata.url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) throw new Error(`No se pudo descargar el medio de WhatsApp (${response.status})`)

  const mime = response.headers.get('content-type') || metadata.mime_type || 'image/jpeg'
  if (!mime.startsWith('image/')) throw new Error('El medio recibido no es una imagen')
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length > 5_000_000) throw new Error('La imagen supera el límite de 5 MB')
  return `data:${mime};base64,${bytes.toString('base64')}`
}
