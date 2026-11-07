import { supabaseAdmin } from '@/lib/supabase'

/**
 * Marca una reserva como ingresada desde el panel. Va después de crearla y por su cuenta:
 * si falta la migración add_booking_origin.sql, la reserva se crea igual y no se marca.
 */
export async function markBookingManual(bookingId: string): Promise<void> {
  const { error } = await supabaseAdmin.from('bookings').update({ created_via: 'admin' }).eq('id', bookingId)
  if (error) console.warn('[bookingOrigin] No se marcó como manual (¿falta add_booking_origin.sql?):', error.message)
}
