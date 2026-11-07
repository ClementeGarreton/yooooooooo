/**
 * Envío de correo DIRECTO con Resend (https://api.resend.com/emails), sin n8n en el medio.
 * Es el único punto del sistema que habla con Resend.
 *
 * Variables del servidor:
 *   RESEND_API_KEY   la API key de Resend. Sin ella no se envía nada por acá.
 *   RESEND_FROM      remitente (opcional). Por defecto el mismo que usaba n8n:
 *                    `Yo me Encargo <contacto@yomeencargo.cl>`.
 *
 * `idempotencyKey` va en la cabecera `Idempotency-Key` de Resend: si el mismo correo se
 * intenta dos veces con la misma clave, Resend no lo manda dos veces.
 */

import { DEFAULT_FROM } from '@/lib/emailTemplates'

export type ResendResult =
  | { ok: true; id: string | null }
  | {
      ok: false
      reason: 'not_configured' | 'paused' | 'dry_run' | 'not_allowlisted' | 'error'
      error?: string
      /** HTTP con que respondió Resend. Sin esto fue timeout o red: no se sabe si salió. */
      status?: number
    }

export interface ResendMessage {
  to: string
  subject: string
  html: string
  text?: string
  idempotencyKey?: string
  timeoutMs?: number
  /** Archivos adjuntos, con el contenido en base64. */
  attachments?: { filename: string; content: string }[]
}

export function resendConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY)
}

const flag = (name: string) => process.env[name] === '1' || process.env[name] === 'true'

/** Envía sin mirar los frenos de entorno: para quien ya los evaluó (`emailLog.ts`). */
export async function sendResendRaw(input: ResendMessage): Promise<ResendResult> {
  if (!resendConfigured()) return { ok: false, reason: 'not_configured' }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 12_000)
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        ...(input.idempotencyKey ? { 'Idempotency-Key': input.idempotencyKey } : {}),
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM || DEFAULT_FROM,
        to: [input.to.trim()],
        subject: input.subject,
        html: input.html,
        ...(input.text ? { text: input.text } : {}),
        ...(input.attachments?.length ? { attachments: input.attachments } : {}),
      }),
      signal: controller.signal,
    })
    const body = await res.json().catch(() => null)
    if (!res.ok) {
      const error = `Resend HTTP ${res.status}: ${String(body?.message || body?.name || '').slice(0, 300)}`
      console.error(`[resend] ${error}`)
      return { ok: false, reason: 'error', error, status: res.status }
    }
    return { ok: true, id: typeof body?.id === 'string' ? body.id : null }
  } catch (e) {
    const error =
      e instanceof Error && e.name === 'AbortError'
        ? 'Resend no respondió a tiempo'
        : `Error de red hablando con Resend: ${e instanceof Error ? e.message : e}`
    console.error(`[resend] ${error}`)
    return { ok: false, reason: 'error', error }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Envía respetando los frenos del sistema de correos: `EMAIL_PAUSED`, `EMAIL_DRY_RUN` y
 * `EMAIL_ALLOWLIST`. Para los envíos que no pasan por `emailLog.ts` (avisos a trabajadores).
 */
export async function sendResendEmail(input: ResendMessage): Promise<ResendResult> {
  if (!resendConfigured()) return { ok: false, reason: 'not_configured' }
  if (flag('EMAIL_PAUSED')) return { ok: false, reason: 'paused' }
  if (flag('EMAIL_DRY_RUN')) return { ok: false, reason: 'dry_run' }
  const to = input.to.trim().toLowerCase()
  const allowlist = (process.env.EMAIL_ALLOWLIST || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
  if (allowlist.length > 0 && !allowlist.includes(to)) return { ok: false, reason: 'not_allowlisted' }
  return sendResendRaw(input)
}
