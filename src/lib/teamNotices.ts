/**
 * AVISOS POR CORREO AL EQUIPO (`ADMIN_NOTIFICATION_EMAIL`).
 *
 * Para lo que hasta oct-2026 solo se veía en el globo de «Por aprobar»: una solicitud nueva
 * de un cliente y una diferencia registrada en terreno. Salen directo por Resend.
 *
 * Son best-effort: lo que avisan ya quedó guardado y se ve en el panel, así que un correo
 * que no sale nunca frena ni deshace la acción. Por eso esta función no lanza.
 */

import { sendSystemEmail } from '@/lib/emailTransport'
import { resendConfigured } from '@/lib/resendClient'
import { siteBaseUrl } from '@/lib/fileLinks'

export async function notifyTeam(notice: {
  subject: string
  lines: string[]
  /** Evita el duplicado si la misma acción se reintenta. */
  key: string
  label: string
}): Promise<boolean> {
  const to = process.env.ADMIN_NOTIFICATION_EMAIL
  // Sin Resend el correo iría al n8n, que no conoce este aviso.
  if (!to || !resendConfigured()) return false
  try {
    const result = await sendSystemEmail(
      { event: 'team_notice', to, subject: notice.subject, lines: notice.lines },
      { label: notice.label, idempotencyKey: notice.key, timeoutMs: 8_000 }
    )
    const sent = result.ok && result.body?.success === true
    if (!sent) console.warn(`[teamNotices][${notice.label}] El aviso no salió:`, result.error || 'sin confirmación')
    return sent
  } catch (error) {
    console.warn(`[teamNotices][${notice.label}] El aviso no salió:`, error instanceof Error ? error.message : error)
    return false
  }
}

/** Dónde se resuelve: la bandeja «Por aprobar» del panel. */
export const approvalsUrl = () => `${siteBaseUrl()}/admin`
