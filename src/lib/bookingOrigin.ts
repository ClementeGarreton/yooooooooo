/**
 * Origen de una reserva: la tomó el cliente en la web, o la ingresó alguien del equipo desde
 * el panel (reserva manual o lead convertido). Puro: lo usan la pantalla y el servidor.
 *
 * Las reservas manuales quedan con `created_via = 'admin'` (add_booking_origin.sql). Antes de
 * esa columna, una reserva manual se reconoce por su ID «ADMIN-…»; la migración además marca
 * las que el registro de actividad muestra creadas desde el panel.
 */
export type BookingOrigin = 'web' | 'manual'

export function bookingOrigin(booking: { created_via?: string | null; quote_id?: string | null }): BookingOrigin {
  return booking.created_via === 'admin' || String(booking.quote_id || '').startsWith('ADMIN-') ? 'manual' : 'web'
}

export const BOOKING_ORIGIN_LABEL: Record<BookingOrigin, string> = { web: 'Web', manual: 'Ingresada a mano' }
