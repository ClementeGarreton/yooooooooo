import { getCustomerBenefits } from '@/lib/coupons'
import { requireCustomerId } from '../../session'
import PageTitle from '../../PageTitle'
import { formatDate } from '../../format'
import CopyCode from './CopyCode'
import CreditsBox from './CreditsBox'
import { siteUrl } from '@/lib/siteUrl'

export const dynamic = 'force-dynamic'

const PRIZE_STATE = {
  disponible: { label: 'Disponible', className: 'bg-green-50 text-green-700' },
  usado: { label: 'Usado', className: 'bg-slate-100 text-slate-500' },
  vencido: { label: 'Vencido', className: 'bg-slate-100 text-slate-500' },
} as const

/**
 * Beneficios (Módulo 5): el código de referido de la persona, cuántos llegaron con él y
 * los cupones de premio que ganó. Los cupones se usan al reservar una cotización. Si el
 * programa de referidos está apagado, la página lo dice y no muestra código.
 */
export default async function BeneficiosPage() {
  const customerId = await requireCustomerId()
  const benefits = await getCustomerBenefits(customerId)
  // Dominio del sitio para el mensaje de WhatsApp, tomado de la configuración (no escrito a mano).
  const site = siteUrl().replace(/^https?:\/\//, '')
  const whereToQuote = site && !site.startsWith('localhost') ? `cotiza en ${site}` : 'cotiza en la web'

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 lg:px-10 lg:py-12">
      <PageTitle title="Beneficios" subtitle="Tu código para recomendar y tus cupones." />

      <div className="grid gap-6 lg:grid-cols-2">
        {benefits.credits.available && <CreditsBox credits={benefits.credits} />}
        <section className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
          <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500">Recomienda Yo me encargo</h2>
          {benefits.live && benefits.referralCode ? (
            <>
              <p className="mt-3 text-slate-700">
                Comparte tu código. Quien lo use en su primer servicio recibe <strong>{benefits.referredLabel} de descuento</strong>
                {benefits.rewardCredits ? (
                  <>
                    , y cuando pague ese servicio tú recibes <strong>{benefits.rewardCredits}</strong> que puedes retirar a tu
                    cuenta (1 crédito = $1).
                  </>
                ) : (
                  <>
                    , y cuando ese servicio se complete tú recibes un cupón de <strong>{benefits.rewardLabel}</strong> para tu
                    próximo servicio.
                  </>
                )}
              </p>
              <div className="mt-4">
                <CopyCode code={benefits.referralCode} />
              </div>
              <a
                href={`https://wa.me/?text=${encodeURIComponent(
                  `Te recomiendo Yo me encargo para tu mudanza. Con mi código ${benefits.referralCode} tienes ${benefits.referredLabel} de descuento en tu primer servicio: ${whereToQuote} y úsalo al reservar desde tu cuenta, o díselo a quien te atienda.`
                )}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 inline-block text-sm font-bold text-brand-blue-dark hover:underline"
              >
                Compartir por WhatsApp →
              </a>
              <dl className="mt-6 grid grid-cols-2 gap-4 border-t border-slate-100 pt-4">
                <div>
                  <dt className="text-sm text-slate-500">Personas que reservaron con tu código</dt>
                  <dd className="text-2xl font-bold text-slate-900">{benefits.referredCount}</dd>
                </div>
                <div>
                  <dt className="text-sm text-slate-500">Servicios ya realizados</dt>
                  <dd className="text-2xl font-bold text-slate-900">{benefits.completedCount}</dd>
                </div>
              </dl>
            </>
          ) : benefits.codePending ? (
            <p className="mt-3 text-sm text-slate-600">
              Tu código para recomendar se activa después de tu primer servicio pagado. Cuando lo tengas, lo vas a encontrar
              aquí.
            </p>
          ) : (
            <p className="mt-3 text-sm text-slate-500">
              El programa de referidos todavía no está activo. Cuando lo esté, aquí vas a encontrar tu código.
            </p>
          )}
        </section>

        <section className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
          <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500">Tus cupones</h2>
          {benefits.prizes.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">
              Todavía no tienes cupones. Si tienes un código de campaña, escríbelo al reservar una cotización.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-slate-100">
              {benefits.prizes.map((p) => (
                <li key={p.code} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <div>
                    <p className="font-mono font-bold text-slate-900">{p.code}</p>
                    <p className="text-sm text-slate-500">
                      {p.label} de descuento{p.validUntil ? ` · vence el ${formatDate(p.validUntil)}` : ''}
                    </p>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-xs font-bold ${PRIZE_STATE[p.state].className}`}>
                    {PRIZE_STATE[p.state].label}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-4 text-sm text-slate-500">
            Los cupones se usan al reservar una cotización vigente, en{' '}
            <a href="/mi-cuenta/cotizaciones" className="font-semibold text-brand-blue-dark hover:underline">
              Cotizaciones
            </a>
            .
          </p>
        </section>
      </div>
    </main>
  )
}
