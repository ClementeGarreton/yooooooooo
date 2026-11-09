/**
 * Aviso por inactividad tras >=10 min sin mensajes del cliente.
 * No usa handoff_requests ni exige migraciones: idempotencia sobre
 * quote_sessions.state.intake.idleReminderForActivityAt.
 * Se ejecuta con un scheduler HTTP externo cada minuto (o GitHub cada 5 min).
 */
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { mutateQuoteSessionAtomically, type QuoteSessionRow } from '@/lib/quoteSession'
import { findOrCreateWhatsAppConversation, logMessage } from '@/lib/ai/conversationStore'
import { sendWhatsAppText } from '@/lib/whatsapp/cloudApi'
import { QUOTE_IDLE_MESSAGE } from '@/lib/whatsapp/quoteConversation'
import { shouldSendIdleReminder } from '@/lib/whatsapp/idleReminder'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
const AFTER_MS = 10 * 60 * 1000
const WITHIN_MS = 23 * 60 * 60 * 1000 // ventana de atención de WhatsApp

type RouterRecord = {
  id: string
  external_user_id: string | null
  quote_session_id: string | null
  last_message_at: string | null
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET no configurado' }, { status: 503 })
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }
  const now = Date.now()
  const before = new Date(now - AFTER_MS).toISOString()
  const after = new Date(now - WITHIN_MS).toISOString()
  const { data, error } = await supabaseAdmin.from('ai_conversations')
    .select('id,external_user_id,quote_session_id,last_message_at')
    .eq('channel', 'whatsapp')
    .eq('model', 'whatsapp-router-v1-ready')
    .eq('status', 'active')
    .lte('last_message_at', before)
    .gte('last_message_at', after)
    .order('last_message_at', { ascending: true })
    .limit(100)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  let sent = 0, skipped = 0, failed = 0
  for (const router of (data || []) as RouterRecord[]) {
    if (!router.quote_session_id || !router.external_user_id || !router.last_message_at) { skipped++; continue }
    const targetActivityAt = router.last_message_at
    const { data: rawSession, error: sessionError } = await supabaseAdmin
      .from('quote_sessions').select('*').eq('id', router.quote_session_id)
      .eq('channel','whatsapp').in('status', ['collecting','ready']).maybeSingle()
    if (sessionError || !rawSession) { skipped++; continue }
    const session = rawSession as QuoteSessionRow
    if (session.state.intake?.quoteFlowVersion !== 2 ||
      !shouldSendIdleReminder({ now, lastActivityAt: targetActivityAt,
        alreadySentFor: session.state.intake?.idleReminderForActivityAt })) { skipped++; continue }
    try {
      // Reservar el aviso antes de enviarlo; evita duplicados entre cron concurrentes.
      let claimed = false
      await mutateQuoteSessionAtomically(session.id, current => {
        claimed = false
        if (!current.intake || current.intake.idleReminderForActivityAt === targetActivityAt) return current
        current.intake.idleReminderForActivityAt = targetActivityAt
        claimed = true
        return current
      })
      if (!claimed) { skipped++; continue }
      // Evitar enviar una alerta vieja si justo llegó una respuesta.
      const { data: currentRouter } = await supabaseAdmin.from('ai_conversations')
        .select('status,last_message_at,quote_session_id').eq('id', router.id).maybeSingle()
      if (!currentRouter || currentRouter.status !== 'active' ||
        currentRouter.quote_session_id !== session.id || currentRouter.last_message_at !== targetActivityAt) {
        skipped++; continue
      }
      const phoneParts = router.external_user_id.split('#')
      const recipient = phoneParts[0].replace(/\D/g, '')
      if (!recipient) { skipped++; continue }
      const senderPhoneId = phoneParts[1] || undefined
      const response = await sendWhatsAppText(recipient, QUOTE_IDLE_MESSAGE, senderPhoneId)
      const conversation = await findOrCreateWhatsAppConversation(router.external_user_id, session.id)
      await logMessage({ conversationId: conversation.id, direction: 'outbound', role: 'assistant',
        content: QUOTE_IDLE_MESSAGE, externalMessageId: response?.messages?.[0]?.id || null })
      sent++
    } catch (sendError) {
      console.error('[whatsapp-idle] No se pudo enviar aviso a sesión', session.id, sendError)
      failed++
    }
  }
  return NextResponse.json({ sent, skipped, failed, checked: data?.length || 0 })
}
