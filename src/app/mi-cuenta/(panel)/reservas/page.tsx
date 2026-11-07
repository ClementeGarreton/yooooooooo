import { redirect } from 'next/navigation'
import { getCustomerAccount, getCustomerCompany } from '@/lib/customerAccount'
import { serviceWords } from '../../serviceWords'
import { chileTodayString } from '@/lib/vehicleAssignment'
import { requireCustomerId } from '../../session'
import BookingCard from '../../BookingCard'
import PageTitle from '../../PageTitle'

export const dynamic = 'force-dynamic'

/** Todas las reservas: primero las que vienen, después el historial. */
export default async function ReservasPage() {
  const customerId = await requireCustomerId()
  const [account, company] = await Promise.all([getCustomerAccount(customerId), getCustomerCompany(customerId)])
  if (!account) redirect('/mi-cuenta/ingresar')
  const words = serviceWords(Boolean(company))

  const today = chileTodayString()
  const isUpcoming = (b: (typeof account.bookings)[number]) =>
    Boolean(b.scheduledDate && b.scheduledDate >= today && ['confirmed', 'pending'].includes(String(b.status)))
  const upcoming = account.bookings
    .filter(isUpcoming)
    .sort((a, b) => `${a.scheduledDate}${a.scheduledTime}`.localeCompare(`${b.scheduledDate}${b.scheduledTime}`))
  const past = account.bookings.filter((b) => !isUpcoming(b))

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 lg:px-10 lg:py-12">
      <PageTitle title="Mis reservas" subtitle="Toca una reserva para ver el detalle, pagar el saldo o cambiar la fecha." />

      <section>
        <h2 className="text-xl font-bold text-slate-900">Próximas</h2>
        {upcoming.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">No tienes {words.scheduled}.</p>
        ) : (
          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {upcoming.map((b) => (
              <BookingCard key={b.id} booking={b} />
            ))}
          </div>
        )}
      </section>

      {past.length > 0 && (
        <section className="mt-10">
          <h2 className="text-xl font-bold text-slate-900">Historial</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {past.map((b) => (
              <BookingCard key={b.id} booking={b} />
            ))}
          </div>
        </section>
      )}
    </main>
  )
}
