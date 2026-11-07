import { redirect } from 'next/navigation'
import { getCompanyBookings, getCustomerCompany } from '@/lib/customerAccount'
import { formatRut } from '@/lib/rut'
import { listEmittedInvoices } from '@/lib/invoicing'
import { requireCustomerId } from '../../session'
import BookingCard from '../../BookingCard'
import PageTitle from '../../PageTitle'

export const dynamic = 'force-dynamic'

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="border-t border-slate-100 py-3 first:border-t-0">
      <dt className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1 text-slate-900">{value || '—'}</dd>
    </div>
  )
}

/**
 * Cuenta empresa (etapa 2): los datos con que se le factura y todas las reservas asignadas
 * a la empresa, las haya hecho quien las haya hecho. El ENCARGADO puede pagarlas y cambiarles
 * la fecha; un miembro las ve en solo lectura. Las facturas y los documentos son del encargado.
 */
export default async function EmpresaPage() {
  const customerId = await requireCustomerId()
  const company = await getCustomerCompany(customerId)
  if (!company) redirect('/mi-cuenta/datos')
  const bookings = await getCompanyBookings(customerId, company)
  const isManager = company.role === 'encargado'
  // Las facturas de la empresa las ve su encargado.
  const invoices = isManager ? await listEmittedInvoices(company.id) : []

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 lg:px-10 lg:py-12">
      <PageTitle
        title={company.razon_social}
        subtitle={`${company.code} · ${isManager ? 'Eres encargado de esta cuenta' : 'Eres miembro de esta cuenta'}`}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="h-fit rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
          <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500">Datos de facturación</h2>
          <dl className="mt-4">
            <Field label="Razón social" value={company.razon_social} />
            <Field label="RUT" value={formatRut(company.rut)} />
            <Field label="Giro" value={company.giro} />
            <Field
              label="Dirección"
              value={[company.direccion, company.comuna, company.ciudad].filter(Boolean).join(', ')}
            />
            <Field label="Correo de facturación" value={company.email_facturacion} />
          </dl>
          <p className="mt-4 text-sm text-slate-500">Si algo está mal, escríbenos y lo corregimos.</p>
        </section>

        <section className="lg:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-bold text-slate-900">
              Historial de la empresa{bookings.length > 0 ? ` (${bookings.length})` : ''}
            </h2>
            {isManager && (
              <a href="/mi-cuenta/documentos" className="text-sm font-bold text-brand-blue-dark hover:underline">
                Ver documentos de la empresa →
              </a>
            )}
          </div>
          {!isManager && (
            <p className="mt-2 text-sm text-slate-500">
              Las ves como miembro de la empresa, en solo lectura. Pagar o cambiar una fecha lo hace el encargado de la
              cuenta.
            </p>
          )}
          {bookings.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">Todavía no hay reservas asignadas a la empresa.</p>
          ) : (
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              {bookings.map((b) => (
                <div key={b.id}>
                  <BookingCard booking={b} />
                  {!b.own && b.clientName && (
                    <p className="mt-1 px-1 text-xs text-slate-500">Reservada por {b.clientName}</p>
                  )}
                </div>
              ))}
            </div>
          )}

          {isManager && invoices.length > 0 && (
            <div className="mt-10">
              <h2 className="text-xl font-bold text-slate-900">Facturas</h2>
              <ul className="mt-4 divide-y divide-slate-100 rounded-2xl border border-slate-100 bg-white px-5 shadow-sm">
                {invoices.map((inv) => (
                  <li key={inv.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                    <div>
                      <p className="font-semibold text-slate-900">Factura N° {inv.folio}</p>
                      <p className="text-sm text-slate-500">
                        Servicios de {inv.period.slice(5)}/{inv.period.slice(0, 4)}
                        {inv.fecha_emision ? ` · emitida el ${inv.fecha_emision.split('-').reverse().join('-')}` : ''}
                      </p>
                    </div>
                    <p className="font-bold text-slate-900">${Math.round(inv.total || 0).toLocaleString('es-CL')}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
