/**
 * Qué documentos puede ver y subir un cliente del panel. Mismas reglas de la empresa que
 * decidió Francisco el 01-10-2026: el ENCARGADO ve todo lo de su empresa; un MIEMBRO o una
 * persona sin empresa, solo lo suyo (lo que subió y lo de sus reservas).
 */

import { supabaseAdmin } from '@/lib/supabase'
import { getCustomerCompany, type AccountCompany } from '@/lib/customerAccount'
import { DOCUMENT_FIELDS, type StoredDocument } from '@/lib/documents'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface DocumentScope {
  customerId: string
  company: AccountCompany | null
  /** Reservas que esta persona puede ver: las suyas y, si es encargado, las de la empresa. */
  bookingIds: string[]
}

export async function getDocumentScope(customerId: string): Promise<DocumentScope> {
  const company = await getCustomerCompany(customerId)
  let query = supabaseAdmin.from('bookings').select('id')
  query =
    company?.role === 'encargado'
      ? query.or(`customer_id.eq.${customerId},company_id.eq.${company.id}`)
      : query.eq('customer_id', customerId)
  const { data } = await query.limit(500)
  return { customerId, company, bookingIds: (data || []).map((b) => b.id) }
}

/** ¿Puede esta persona ver este documento? */
export function canSeeDocument(
  scope: DocumentScope,
  doc: Pick<StoredDocument, 'customer_id' | 'booking_id' | 'company_id' | 'uploaded_by_type'>
): boolean {
  // Lo que sube el equipo en terreno (fotos internas, respaldos de gastos) es del admin:
  // el cliente no lo ve. Qué se le muestra lo define el módulo de modificaciones.
  if (doc.uploaded_by_type === 'trabajador') return false
  if (doc.customer_id === scope.customerId) return true
  if (doc.booking_id && scope.bookingIds.includes(doc.booking_id)) return true
  return scope.company?.role === 'encargado' && doc.company_id === scope.company.id
}

/** ¿Puede subir documentos a esta reserva? Solo a las que ve. */
export function canUploadToBooking(scope: DocumentScope, bookingId: string): boolean {
  return UUID_RE.test(bookingId) && scope.bookingIds.includes(bookingId)
}

/** Documentos visibles para la persona, del más nuevo al más viejo. */
export async function listCustomerDocuments(scope: DocumentScope, opts: { bookingId?: string } = {}): Promise<StoredDocument[]> {
  let query = supabaseAdmin
    .from('documents')
    .select(DOCUMENT_FIELDS)
    .neq('uploaded_by_type', 'trabajador') // ver canSeeDocument
    .order('created_at', { ascending: false })
    .limit(200)

  if (opts.bookingId) {
    if (!canUploadToBooking(scope, opts.bookingId)) return []
    query = query.eq('booking_id', opts.bookingId)
  } else {
    const filters = [`customer_id.eq.${scope.customerId}`]
    if (scope.bookingIds.length) filters.push(`booking_id.in.(${scope.bookingIds.join(',')})`)
    if (scope.company?.role === 'encargado') filters.push(`company_id.eq.${scope.company.id}`)
    query = query.or(filters.join(','))
  }

  const { data, error } = await query
  if (error) {
    console.error('[customerDocuments] Error listando documentos:', error)
    return []
  }
  return (data || []) as StoredDocument[]
}

/** Un documento si la persona lo puede ver; si no, null (igual que si no existiera). */
export async function getVisibleDocument(scope: DocumentScope, documentId: string): Promise<StoredDocument | null> {
  if (!UUID_RE.test(documentId)) return null
  const { data } = await supabaseAdmin.from('documents').select(DOCUMENT_FIELDS).eq('id', documentId).maybeSingle()
  if (!data || !canSeeDocument(scope, data as StoredDocument)) return null
  return data as StoredDocument
}

/** Código de la reserva de cada documento, para mostrar a qué servicio corresponde. */
export async function bookingCodesFor(docs: Pick<StoredDocument, 'booking_id'>[]): Promise<Map<string, string>> {
  const ids = Array.from(new Set(docs.map((d) => d.booking_id).filter((id): id is string => !!id)))
  if (ids.length === 0) return new Map()
  const { data } = await supabaseAdmin.from('bookings').select('id, code').in('id', ids)
  return new Map((data || []).filter((b) => b.code).map((b) => [b.id, `Reserva ${b.code}`]))
}
