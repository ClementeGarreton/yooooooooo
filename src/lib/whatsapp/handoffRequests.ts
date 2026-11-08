import { supabaseAdmin } from '@/lib/supabase'
import type { QuoteSessionRow } from '@/lib/quoteSession'

/** Registro legible por Prospectos aun cuando el cliente no tenga una cotización terminada. */
export async function createHandoffRequest(input: {
  phone: string
  channel?: string
  session?: QuoteSessionRow | null
}) {
  const state = input.session?.state
  const { error } = await supabaseAdmin.from('handoff_requests').insert({
    phone: input.phone,
    channel: input.channel || 'whatsapp',
    quote_session_id: input.session?.id || null,
    quote_id: input.session?.quote_id || null,
    customer_name: state?.personalInfo.name || null,
    customer_email: state?.personalInfo.email || null,
    quote_snapshot: state || {},
    status: 'pending',
  })
  if (error) throw new Error(`No se pudo registrar derivación: ${error.message}`)
}

/** Guarda la primera explicación del cliente, sin interrumpir los siguientes mensajes humanos. */
export async function collectHandoffDetails(phone: string, text: string) {
  if (!text.trim()) return false
  const { data, error } = await supabaseAdmin.from('handoff_requests')
    .select('id').eq('phone', phone).eq('status', 'pending')
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (error) throw new Error(`No se pudo consultar la derivación: ${error.message}`)
  if (!data) return false
  const plain = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const reason = /reclamo|queja/.test(plain) ? 'Reclamo'
    : /cotizador|no funcion|no sirvio|error/.test(plain) ? 'Problema con cotizador'
    : /trabajo|servicio en curso/.test(plain) ? 'Seguimiento de trabajo'
    : /seguimiento|cotizacion|presupuesto/.test(plain) ? 'Seguimiento de cotización'
    : 'Otra consulta'
  const reference = text.match(/\bCOT[-\s]?\d{3,}\b/i)?.[0] || null
  const changes: Record<string, unknown> = {
    reason, details: text.trim().slice(0, 3000), status: 'ready', updated_at: new Date().toISOString(),
  }
  // No sobrescribir la referencia de cotización existente si el cliente no repite su número.
  if (reference) changes.quote_id = reference
  const { error: updateError } = await supabaseAdmin.from('handoff_requests')
    .update(changes)
    .eq('id', data.id).eq('status', 'pending')
  if (updateError) throw new Error(`No se pudo guardar motivo: ${updateError.message}`)
  return true
}
