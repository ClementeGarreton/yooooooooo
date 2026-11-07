/**
 * Envío por correo del detalle de pago de un período cerrado (Tomás, 27-10-2026: «las
 * liquidaciones de sueldo, poder enviarlas por mail»). Va al correo de la ficha del funcionario,
 * con el mismo PDF que se descarga en Cierre de pagos. Solo períodos cerrados: lo abierto
 * todavía puede cambiar. Sale por Resend respetando los frenos de correo (resendClient.ts).
 */

import { supabaseAdmin } from '@/lib/supabase'
import { isValidEmail } from '@/lib/emailFormat'
import { resendConfigured, sendResendEmail } from '@/lib/resendClient'
import { buildStatementsPdf } from '@/lib/payStatementExport'
import { siteUrl } from '@/lib/siteUrl'
import { WorkerPayError, getPayClosingDetail } from '@/lib/workerPay'
import type { WorkerPayData } from '@/lib/workerPayTypes'

const day = (d: string) => d.slice(0, 10).split('-').reverse().join('-')
const clp = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(Math.round(n)).toLocaleString('es-CL')}`
const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const REASON: Record<string, string> = {
  paused: 'los correos están pausados',
  dry_run: 'los correos están en modo prueba',
  not_allowlisted: 'su correo no está en la lista permitida',
  not_configured: 'falta configurar Resend',
}

export interface PayStatementEmailResult {
  sent: { name: string; email: string }[]
  skipped: { name: string; reason: string }[]
}

/** Manda el detalle de cada cierre a su funcionario. Uno que falla no frena a los demás. */
export async function emailPayStatements(rawIds: unknown): Promise<PayStatementEmailResult> {
  const ids = Array.isArray(rawIds) ? Array.from(new Set(rawIds.filter((id): id is string => typeof id === 'string'))) : []
  if (ids.length === 0) throw new WorkerPayError('Elige al menos un período cerrado.')
  if (ids.length > 100) throw new WorkerPayError('Son demasiados de una vez (hasta 100).')
  if (!resendConfigured()) throw new WorkerPayError('El envío de correos no está configurado (falta RESEND_API_KEY).', 503)

  const result: PayStatementEmailResult = { sent: [], skipped: [] }
  const payCache = new Map<string, Promise<WorkerPayData>>()
  for (const id of ids) {
    let name = 'Cierre'
    try {
      const detail = await getPayClosingDetail(id, null, payCache)
      const s = detail.statement
      name = s.name
      const { data: worker } = await supabaseAdmin.from('workers').select('name, email').eq('id', detail.workerId).maybeSingle()
      const email = String(worker?.email || '').trim()
      if (!isValidEmail(email)) {
        result.skipped.push({ name, reason: 'no tiene correo en su ficha' })
        continue
      }
      const pdf = buildStatementsPdf([detail])
      const firstName = (worker?.name || s.name).split(' ')[0]
      const period = `del ${day(s.from)} al ${day(s.to)}`
      const panelUrl = `${siteUrl()}/trabajos?vista=pagos`
      const sent = await sendResendEmail({
        to: email,
        subject: `Detalle de pago ${period} · Yo me encargo`,
        text:
          `Hola ${firstName}:\n\nTe adjuntamos el detalle de tu pago ${period}.\n` +
          `Total del período: ${clp(s.total)}. Pagado: ${clp(detail.paid)}. Saldo: ${clp(s.total - detail.paid)}.\n\n` +
          `También lo puedes descargar en tu panel: ${panelUrl}\n`,
        html:
          `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#1f2937">` +
          `<div style="background:#1B3A5C;color:#fff;padding:16px 20px;border-radius:12px 12px 0 0;font-weight:bold">Yo me encargo · Mi equipo</div>` +
          `<div style="border:1px solid #e5e7eb;border-top:0;padding:20px;border-radius:0 0 12px 12px">` +
          `<p style="margin:0 0 8px">Hola ${escapeHtml(firstName)}:</p>` +
          `<p style="margin:0 0 12px">Te adjuntamos el detalle de tu pago ${period}.</p>` +
          `<p style="margin:0 0 16px;color:#4b5563">Total del período: <b>${clp(s.total)}</b><br>Pagado: ${clp(detail.paid)}<br>Saldo: ${clp(s.total - detail.paid)}</p>` +
          `<a href="${panelUrl}" style="display:inline-block;background:#2C5282;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:bold">Ver en mi panel</a>` +
          `</div></div>`,
        attachments: [
          { filename: `detalle_pago_${s.code}_${s.from}_${s.to}.pdf`, content: Buffer.from(pdf.output('arraybuffer')).toString('base64') },
        ],
      })
      if (sent.ok) result.sent.push({ name, email })
      else result.skipped.push({ name, reason: REASON[sent.reason] || sent.error || 'Resend no lo aceptó' })
      // Resend acepta pocos envíos por segundo: con muchos de una vez, se espacian.
      if (ids.length > 1) await new Promise((resolve) => setTimeout(resolve, 600))
    } catch (error) {
      result.skipped.push({ name, reason: error instanceof WorkerPayError ? error.message : 'no se pudo armar el correo' })
      if (!(error instanceof WorkerPayError)) console.error('[worker-pay/email] Error:', error)
    }
  }
  return result
}
