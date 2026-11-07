import { redirect } from 'next/navigation'
import { getCompanyBookings, getCustomerAccount, getCustomerCompany } from '@/lib/customerAccount'
import { chileTodayString } from '@/lib/vehicleAssignment'
import { requireCustomerId } from '../session'
import BookingCard from '../BookingCard'
import QuoteCard from '../QuoteCard'
import PageTitle from '../PageTitle'
import BookingStatus from '../BookingStatus'
import { clp, formatLongDate, route } from '../format'
import { serviceWords } from '../serviceWords'

export const dynamic = 'force-dynamic'

function Stat({ label, value, href }: { label: string; value: string; href: string }) {
  return (
    <a href={href} className="block rounded-2xl border border-slate-100 bg-white p-5 shadow-sm transition hover:border-brand-blue hover:shadow-md">
      <p className="text-sm font-semibold text-slate-500">{label}</p>
      <p className="mt-2 text-3xl font-bold text-slate-900">{value}</p>
    </a>
  )
}

/** Resumen: lo próximo que tiene la persona y lo que puede hacer ahora. */
export default async function ResumenPage() {
  const customerId = await requireCustomerId()
  const account = await getCustomerAccount(customerId)
  if (!account) redirect('/mi-cuenta/ingresar')

  const { customer, quotes, bookings } = account
  const today = chileTodayString()
  const upcoming = bookings
    .filter((b) => b.scheduledDate && b.scheduledDate >= today && ['confirmed', 'pending'].includes(String(b.status)))
    .sort((a, b) => `${a.scheduledDate}${a.scheduledTime}`.localeCompare(`${b.scheduledDate}${b.scheduledTime}`))
  const next = upcoming[0]
  const outstanding = quotes.filter((q) => q.isOutstanding)
  const pendingTotal = upcoming.reduce((sum, b) => sum + b.pending, 0)
  const firstName = (customer.name || '').split(' ')[0]
  // Quien pertenece a una empresa ve acá mismo las reservas de la empresa: si no, alguien
  // sin mudanzas propias por delante abría su cuenta y no veía nada.
  const company = await getCustomerCompany(customerId)
  const companyBookings = company ? await getCompanyBookings(customerId, company) : []
  const words = serviceWords(Boolean(company))

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 lg:px-10 lg:py-12">
      <PageTitle title={`Hola${firstName ? `, ${firstName}` : ''}`} subtitle={`${customer.code} · ${customer.email}`} />

      {next ? (
        <a
          href={`/mi-cuenta/reservas/${next.id}`}
          className="group block rounded-3xl bg-[#1B3A5C] p-6 text-white shadow-lg transition hover:bg-[#214670] lg:p-8"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs font-bold tracking-wide text-slate-300">{words.next.toUpperCase()} · {next.code}</p>
            <BookingStatus status={next.status} />
          </div>
          <p className="mt-3 text-2xl font-bold lg:text-3xl">
            {formatLongDate(next.scheduledDate)}
            {next.scheduledTime ? ` · ${next.scheduledTime.slice(0, 5)}` : ''}
          </p>
          <p className="mt-2 text-slate-200">{route(next.origin, next.destination)}</p>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            {next.pending > 0 ? (
              <p className="text-amber-300">Saldo pendiente: <strong>{clp(next.pending)}</strong></p>
            ) : (
              <p className="text-lime-300">Sin saldo pendiente</p>
            )}
            <span className="rounded-lg bg-brand-green px-4 py-2 font-bold text-slate-900">Ver detalle, pagar o cambiar fecha →</span>
          </div>
        </a>
      ) : (
        <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-6 lg:p-8">
          <p className="text-lg font-bold text-slate-900">No tienes {words.scheduled}</p>
          <p className="mt-1 text-slate-500">Reserva una cotización vigente o cotiza una nueva en minutos.</p>
          <a href="/cotizador?start=online" className="mt-4 inline-block rounded-lg bg-brand-green px-4 py-2 font-bold text-slate-900 hover:bg-brand-green-hover">
            {words.quote}
          </a>
        </div>
      )}

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <Stat label={words.scheduled.charAt(0).toUpperCase() + words.scheduled.slice(1)} value={String(upcoming.length)} href="/mi-cuenta/reservas" />
        <Stat label="Cotizaciones vigentes" value={String(outstanding.length)} href="/mi-cuenta/cotizaciones" />
        <Stat label="Saldo por pagar" value={clp(pendingTotal)} href="/mi-cuenta/reservas" />
      </div>

      {upcoming.length > 1 && (
        <section className="mt-10">
          <h2 className="text-xl font-bold text-slate-900">{words.otherScheduled}</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {upcoming.slice(1).map((b) => (
              <BookingCard key={b.id} booking={b} />
            ))}
          </div>
        </section>
      )}

      {company && (
        <section className="mt-10">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold text-slate-900">Reservas de {company.razon_social}</h2>
              <p className="text-sm text-slate-500">
                {company.role === 'encargado'
                  ? 'Eres encargado de la cuenta: puedes verlas, pagarlas y cambiarles la fecha.'
                  : 'Eres miembro de la empresa: las ves en solo lectura.'}
              </p>
            </div>
            <a href="/mi-cuenta/empresa" className="text-sm font-bold text-brand-blue-dark hover:underline">
              {companyBookings.length > 3 ? `Ver las ${companyBookings.length} reservas →` : 'Ver todo lo de la empresa →'}
            </a>
          </div>
          {companyBookings.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">
              Todavía no hay reservas asignadas a la empresa.
            </p>
          ) : (
            <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {companyBookings.slice(0, 3).map((b) => (
                <div key={b.id}>
                  <BookingCard booking={b} />
                  {b.clientName && (
                    <p className="mt-1 px-1 text-xs text-slate-500">Reservada por {b.own ? 'ti' : b.clientName}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {outstanding.length > 0 && (
        <section className="mt-10">
          <div className="flex items-end justify-between">
            <h2 className="text-xl font-bold text-slate-900">Cotizaciones que puedes reservar</h2>
            <a href="/mi-cuenta/cotizaciones" className="text-sm font-bold text-brand-blue-dark hover:underline">Ver todas →</a>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {outstanding.slice(0, 3).map((q) => (
              <QuoteCard key={q.id} quote={q} />
            ))}
          </div>
        </section>
      )}
    </main>
  )
}
