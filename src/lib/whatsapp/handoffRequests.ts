import { supabaseAdmin } from '@/lib/supabase'
import type { QuoteSessionRow } from '@/lib/quoteSession'

/** Registro legible por Prospectos aun cuando el cliente no tenga una cotización terminada. */
export async function createHandoffRequest(input: {
  phone: string
  channel?: string
  session?: QuoteSessionRow | null
  reason?: string | null
  details?: string | null
  status?: 'pending' | 'ready'
  estimatedPrice?: number | null
}) {
  const state = input.session?.state
  const value = {
    phone: input.phone,
    channel: input.channel || 'whatsapp',
    quote_session_id: input.session?.id || null,
    quote_id: input.session?.quote_id || null,
    customer_name: state?.personalInfo.name || null,
    customer_email: state?.personalInfo.email || null,
    quote_snapshot: state ? { ...state, priceEstimateForReview: input.estimatedPrice ?? null } : {},
    reason: input.reason || null,
    details: input.details || null,
    status: input.status || 'pending',
    updated_at: new Date().toISOString(),
  }
  // Ante repetición de webhooks o correcciones: ACTUALIZAR el caso, no duplicarlo.
  if (input.session?.id) {
    const { data: existing, error: lookupError } = await supabaseAdmin.from('handoff_requests')
      .select('id,quote_snapshot').eq('quote_session_id', input.session.id)
      .in('status', ['pending', 'ready']).order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (lookupError) throw new Error(`No se pudo consultar derivación: ${lookupError.message}`)
    if (existing) {
      if (existing.quote_snapshot?.tommyReviewHistory) {
        value.quote_snapshot = { ...value.quote_snapshot, tommyReviewHistory: existing.quote_snapshot.tommyReviewHistory }
      }
      const { error } = await supabaseAdmin.from('handoff_requests').update(value).eq('id', existing.id)
      if (error) throw new Error(`No se pudo actualizar derivación: ${error.message}`)
      return
    }
  }
  const { error } = await supabaseAdmin.from('handoff_requests').insert(value)
  if (error) throw new Error(`No se pudo registrar derivación: ${error.message}`)
}

/** Guarda la primera explicación del cliente, sin interrumpir los siguientes mensajes humanos. */
/** Acumula antecedentes en vez de perderlos si el cliente responde en varios mensajes. */
export async function collectHandoffDetails(phone: string, text: string): Promise<{ received: boolean; reply: string }> {
  if (!text.trim()) return { received: false, reply: '' }
  const { data, error } = await supabaseAdmin.from('handoff_requests')
    .select('id,reason,details,customer_email').eq('phone', phone).eq('status', 'pending')
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (error) throw new Error(`No se pudo consultar la derivación: ${error.message}`)
  if (!data) return { received: false, reply: '' }
  const incoming = text.trim().slice(0, 3000)
  const full = [data.details, incoming].filter(Boolean).join('\n').slice(0, 3000)
  const newEmail = incoming.match(/[\w.+-]+@[\w.-]+\.[a-zA-Z]{2,}/)?.[0] || null
  const email = newEmail || data.customer_email || null
  const isFollowup = /seguimiento/i.test(data.reason || '')
  const hasDetails = full.split('\n').some(part => part.trim().length > 0 && !/^[\w.+-]+@[\w.-]+\.[a-zA-Z]{2,}[.!\s]*$/.test(part.trim()) && !/^[+()\d\s-]{8,20}$/.test(part.trim()))
  const needsEmail = isFollowup && !email
  const needsDetails = !hasDetails
  const next = needsEmail ? '¿Me indicas el correo con el que hiciste la reserva?'
    : needsDetails ? '¿Qué necesitas que revisemos de tu caso?'
      : 'Gracias. Ya registramos tus antecedentes para que nuestro equipo te atienda.'
  const reference = full.match(/\bCOT[-\s]?\d{3,}\b/i)?.[0] || null
  const changes: Record<string, unknown> = {
    details: full, status: needsEmail || needsDetails ? 'pending' : 'ready', updated_at: new Date().toISOString(),
  }
  if (reference) changes.quote_id = reference
  if (email) changes.customer_email = email
  const { error: updateError } = await supabaseAdmin.from('handoff_requests')
    .update(changes).eq('id', data.id).eq('status', 'pending')
  if (updateError) throw new Error(`No se pudo guardar motivo: ${updateError.message}`)
  return { received: true, reply: next }
}

/** Elegir un motivo no equivale a entregar los antecedentes del caso. */
export async function setPendingHandoffReason(phone: string, reason: string) {
  const { data, error } = await supabaseAdmin.from('handoff_requests')
    .select('id').eq('phone', phone).eq('status', 'pending')
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (error) throw new Error(`No se pudo consultar la derivación: ${error.message}`)
  if (!data) return false
  const { error: saveError } = await supabaseAdmin.from('handoff_requests')
    .update({ reason, updated_at: new Date().toISOString() }).eq('id', data.id)
  if (saveError) throw new Error(`No se pudo guardar motivo: ${saveError.message}`)
  return true
}
