import type { AccountBooking } from '@/lib/customerAccount'
import BookingStatus from './BookingStatus'
import { clp, formatDate, formatTime, route } from './format'

/** Tarjeta de reserva: toda la tarjeta lleva al detalle, donde están las acciones. */
export default function BookingCard({ booking }: { booking: AccountBooking }) {
  return (
    <a
      href={`/mi-cuenta/reservas/${booking.id}`}
      className="group block rounded-2xl border border-slate-100 bg-white p-5 shadow-sm transition hover:border-brand-blue hover:shadow-md"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-bold text-brand-blue-dark">{booking.code || 'Reserva'}</span>
        <BookingStatus status={booking.status} />
      </div>
      <p className="mt-2 font-semibold text-slate-900">{route(booking.origin, booking.destination)}</p>
      <p className="mt-1 text-sm text-slate-500">
        {formatDate(booking.scheduledDate)}
        {formatTime(booking.scheduledTime)}
      </p>
      {booking.price > 0 && (
        <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
          <div>
            <dt className="text-slate-500">Total</dt>
            <dd className="font-bold text-slate-900">{clp(booking.price)}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Pagado</dt>
            <dd className="font-bold text-slate-900">{clp(booking.paid)}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Saldo</dt>
            <dd className={`font-bold ${booking.pending > 0 ? 'text-amber-600' : 'text-slate-900'}`}>
              {clp(booking.pending)}
            </dd>
          </div>
        </dl>
      )}
      <p className="mt-4 text-sm font-bold text-brand-blue-dark group-hover:underline">Ver detalle y opciones →</p>
    </a>
  )
}
