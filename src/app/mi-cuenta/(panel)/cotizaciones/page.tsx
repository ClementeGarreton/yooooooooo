import { redirect } from 'next/navigation'
import { getCustomerAccount, getCustomerCompany } from '@/lib/customerAccount'
import { serviceWords } from '../../serviceWords'
import { requireCustomerId } from '../../session'
import QuoteCard from '../../QuoteCard'
import PageTitle from '../../PageTitle'

export const dynamic = 'force-dynamic'

/** Cotizaciones: las vigentes se pueden reservar; las vencidas, descargar o cotizar de nuevo. */
export default async function CotizacionesPage() {
  const customerId = await requireCustomerId()
  const [account, company] = await Promise.all([getCustomerAccount(customerId), getCustomerCompany(customerId)])
  if (!account) redirect('/mi-cuenta/ingresar')
  const words = serviceWords(Boolean(company))

  const vigentes = account.quotes.filter((q) => q.isOutstanding)
  const vencidas = account.quotes.filter((q) => !q.isOutstanding)

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 lg:px-10 lg:py-12">
      <PageTitle title="Cotizaciones" subtitle="Reserva una cotización vigente al mismo precio, o descarga su PDF." />

      <section>
        <h2 className="text-xl font-bold text-slate-900">Vigentes</h2>
        {vigentes.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">
            No tienes cotizaciones vigentes.{' '}
            <a href="/cotizador?start=online" className="font-semibold text-brand-blue-dark underline">{words.quoteNow}</a>.
          </p>
        ) : (
          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {vigentes.map((q) => (
              <QuoteCard key={q.id} quote={q} />
            ))}
          </div>
        )}
      </section>

      {vencidas.length > 0 && (
        <section className="mt-10">
          <h2 className="text-xl font-bold text-slate-900">Vencidas</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {vencidas.map((q) => (
              <QuoteCard key={q.id} quote={q} />
            ))}
          </div>
        </section>
      )}
    </main>
  )
}
