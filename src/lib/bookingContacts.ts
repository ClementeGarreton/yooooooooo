/**
 * CONTACTO CON EL CLIENTE DE UNA RESERVA (pedido de Tomás, 14-10-2026).
 *
 * Cada vez que alguien del panel abre el WhatsApp o el correo de un cliente desde Reservas,
 * queda un registro en Actividad (`booking.contacted`, con el canal y quién fue). La lista
 * de Reservas lo usa para marcar «Contactado» o «Sin contactar». Sin tabla nueva: es el
 * mismo registro de Actividad que ya guarda cada cambio, y deja la historia de quién habló
 * con quién y cuándo.
 *
 * Abrir el WhatsApp no garantiza que el mensaje se haya enviado: es la mejor señal que
 * tiene el panel sin integrarse con WhatsApp.
 */

import type { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getActorFromRequest, logAdminAction } from '@/lib/activityLog'

export type ContactChannel = 'whatsapp' | 'email'

export interface BookingContact {
  at: string
  by: string | null
  channel: ContactChannel
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CHANNEL_LABEL: Record<ContactChannel, string> = { whatsapp: 'WhatsApp', email: 'correo' }

export async function recordBookingContact(request: NextRequest, bookingId: string, rawChannel: unknown): Promise<BookingContact | null> {
  if (!UUID_RE.test(bookingId)) return null
  const channel: ContactChannel = rawChannel === 'email' ? 'email' : 'whatsapp'
  const { data: booking } = await supabaseAdmin.from('bookings').select('id, code, client_name').eq('id', bookingId).maybeSingle()
  if (!booking) return null
  const actor = getActorFromRequest(request)
  await logAdminAction({
    actor,
    action: 'booking.contacted',
    entityType: 'booking',
    entityId: booking.id,
    entityLabel: [booking.code, booking.client_name].filter(Boolean).join(' · '),
    summary: `Contactó a ${booking.client_name || 'el cliente'} por ${CHANNEL_LABEL[channel]}`,
    changes: { canal: { from: null, to: channel } },
    request,
  })
  return { at: new Date().toISOString(), by: actor?.username || null, channel }
}

/** Último contacto de cada reserva. Las que nunca se contactaron no vienen. */
export async function getBookingContacts(rawIds: unknown): Promise<Record<string, BookingContact>> {
  const ids = Array.isArray(rawIds) ? Array.from(new Set(rawIds.filter((id): id is string => typeof id === 'string' && UUID_RE.test(id)))).slice(0, 3000) : []
  const out: Record<string, BookingContact> = {}
  // De a 150: la lista va en la URL de la consulta.
  for (let i = 0; i < ids.length; i += 150) {
    const { data, error } = await supabaseAdmin
      .from('admin_activity_log')
      .select('entity_id, actor_username, created_at, changes')
      .eq('action', 'booking.contacted')
      .in('entity_id', ids.slice(i, i + 150))
      .order('created_at', { ascending: false })
    if (error) throw new Error(`No se pudieron leer los contactos: ${error.message}`)
    for (const row of (data || []) as any[]) {
      if (out[row.entity_id]) continue
      out[row.entity_id] = { at: row.created_at, by: row.actor_username ?? null, channel: row.changes?.canal?.to === 'email' ? 'email' : 'whatsapp' }
    }
  }
  return out
}
