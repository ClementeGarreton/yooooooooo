/**
 * Por dónde sale cada correo del sistema.
 *
 * Con `RESEND_API_KEY` en el servidor: se arma acá (`emailTemplates.ts`) y sale DIRECTO
 * por Resend. Sin n8n.
 *
 * Sin esa variable: sigue saliendo por el webhook de n8n, como siempre. Es la red de
 * seguridad de la mudanza: desplegar este código antes de cargar la key no corta ni un
 * correo. Cuando la key esté cargada y probada, n8n deja de recibir llamadas solo.
 *
 * Devuelve el mismo `N8nPostResult` que `postQuoteWebhook`, con la misma lectura que ya
 * hacen los emisores:
 *   ok + body.success === true  → enviado
 *   !ok con `status`            → Resend contestó que NO: fallo definitivo, reintentable
 *   !ok sin `status`            → timeout o red: ambiguo, no se reintenta solo
 */

import { postQuoteWebhook, type N8nPostResult } from '@/lib/n8nClient'
import { renderEmail, type RenderedEmail } from '@/lib/emailTemplates'
import { resendConfigured, sendResendRaw } from '@/lib/resendClient'

export function emailTransportName(): 'resend' | 'n8n' {
  return resendConfigured() ? 'resend' : 'n8n'
}

export async function sendSystemEmail(
  payload: Record<string, unknown>,
  opts: { timeoutMs?: number; label?: string; idempotencyKey?: string } = {}
): Promise<N8nPostResult> {
  if (!resendConfigured()) return postQuoteWebhook(payload, { timeoutMs: opts.timeoutMs, label: opts.label })

  const label = opts.label ?? String(payload?.event || 'correo')
  let email: RenderedEmail
  try {
    email = renderEmail(payload)
  } catch (e) {
    // Evento sin plantilla o payload sin destinatario: es el 422 que devolvía n8n.
    const error = e instanceof Error ? e.message : String(e)
    console.error(`[email][${label}] No se pudo armar el correo: ${error}`)
    return { ok: false, status: 422, error }
  }

  const result = await sendResendRaw({ ...email, idempotencyKey: opts.idempotencyKey, timeoutMs: opts.timeoutMs })
  if (result.ok) {
    console.info(`[email][${label}] Enviado por Resend (${result.id || 'sin id'}).`)
    return { ok: true, status: 200, body: { success: true, id: result.id } }
  }
  return { ok: false, status: result.status, error: result.error || result.reason }
}
