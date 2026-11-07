import { getCustomerCompany } from '@/lib/customerAccount'
import { supabaseAdmin } from '@/lib/supabase'
import { readPricingConfig } from '@/lib/server/pricingConfigServer'
import { withExtraServicesDefaults } from '@/lib/extraServices'
import { tariffLabel } from '@/lib/companyClosingTypes'
import { chileTodayString } from '@/lib/vehicleAssignment'
import { requireCustomerId } from '../../../session'
import PageTitle from '../../../PageTitle'
import RequestForm from './RequestForm'

export const dynamic = 'force-dynamic'

/**
 * Nueva solicitud (Módulo 3): mudanza, transporte, carga o pallets, para la persona o su
 * empresa. Trae el monto de repaletizar (Configuración → Precios) y, si la empresa tiene su
 * propio recargo de urgencia, el monto de la tarifa prioritaria.
 */
export default async function NuevaSolicitudPage() {
  const customerId = await requireCustomerId()
  const company = await getCustomerCompany(customerId)
  const [pricing, tariff] = await Promise.all([
    readPricingConfig().catch(() => null),
    company
      ? supabaseAdmin.from('companies').select('*').eq('id', company.id).maybeSingle().then((r) => r.data as Record<string, any> | null)
      : Promise.resolve(null),
  ])
  const repalletizePrice = pricing ? withExtraServicesDefaults(pricing.additionalServices).repalletize : 0
  // Solo un monto que la empresa tiene pactado (p. ej. Monfiza): si no, se confirma al aprobar.
  const urgency = tariff && tariff.urgency_price != null ? Number(tariff.urgency_price) : null
  const priorityLabel =
    urgency !== null && urgency > 0 ? `${tariffLabel(urgency, tariff?.tariff_currency === 'CLP' ? 'CLP' : 'UF')} + IVA` : null

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 lg:px-10 lg:py-12">
      <a href="/mi-cuenta/solicitudes" className="text-sm font-semibold text-brand-blue-dark hover:underline">
        ← Solicitudes
      </a>
      <div className="mt-4">
        <PageTitle title="Nueva solicitud" subtitle="Mudanza, transporte, carga o pallets desde la misma cuenta." />
      </div>
      <RequestForm
        today={chileTodayString()}
        companyName={company?.razon_social || null}
        repalletizePrice={repalletizePrice}
        priorityLabel={priorityLabel}
      />
    </main>
  )
}
