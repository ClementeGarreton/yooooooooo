/**
 * A qué se asocia una subida del Panel del Cliente: valida la reserva (solo una que la
 * persona ve) y resuelve la empresa, para que el encargado y la facturación encuentren
 * el documento. Lo comparten los pasos «subir» y «confirmar», que tienen que decidir lo
 * mismo.
 */

import { supabaseAdmin } from '@/lib/supabase'
import { canUploadToBooking, getDocumentScope } from '@/lib/customerDocuments'

export type UploadTarget =
  | { ok: true; folder: string; bookingId: string | null; companyId: string | null; label: string }
  | { ok: false; status: number; error: string }

export async function resolveCustomerUploadTarget(customerId: string, rawBookingId: unknown): Promise<UploadTarget> {
  const scope = await getDocumentScope(customerId)
  const bookingId = String(rawBookingId || '').trim() || null
  let companyId = scope.company?.id || null

  if (bookingId) {
    if (!canUploadToBooking(scope, bookingId)) return { ok: false, status: 404, error: 'Reserva no encontrada' }
    const { data: booking } = await supabaseAdmin.from('bookings').select('company_id').eq('id', bookingId).maybeSingle()
    companyId = booking?.company_id || companyId
  }

  const { data: customer } = await supabaseAdmin.from('customers').select('code, name').eq('id', customerId).maybeSingle()
  return {
    ok: true,
    folder: `clientes/${customerId}`,
    bookingId,
    companyId,
    label: [customer?.name, customer?.code].filter(Boolean).join(' · '),
  }
}
