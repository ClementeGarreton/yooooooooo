import { redirect } from 'next/navigation'
import { getCustomerAccount, getCustomerCompany } from '@/lib/customerAccount'
import { requireCustomerId } from '../../session'
import PageTitle from '../../PageTitle'
import { customerHasPassword } from '@/lib/customerPassword'
import PasswordBox from './PasswordBox'
import BankDataBox from '../../BankDataBox'
import { getCustomerBankData } from '@/lib/referralCredits'

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
 * Mis datos (Módulo 1, puntos 2 y 3): perfil personal con código de cliente y, si la
 * persona está asociada a una empresa, la cuenta empresa con sus datos de facturación.
 * El perfil y la empresa son solo lectura: los cambios los hace el equipo, para que la ficha
 * que usa el admin no quede desfasada de lo que ve el cliente. Los datos de transferencia sí
 * los cambia el cliente (los mismos de «Beneficios»).
 */
export default async function DatosPage() {
  const customerId = await requireCustomerId()
  const [account, company] = await Promise.all([getCustomerAccount(customerId), getCustomerCompany(customerId)])
  if (!account) redirect('/mi-cuenta/ingresar')
  const { customer } = account
  // null = todavía no se corrió add_customer_accounts.sql: no se ofrece crear clave.
  const [hasPassword, bankData] = await Promise.all([customerHasPassword(customerId), getCustomerBankData(customerId)])

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 lg:px-10 lg:py-12">
      <PageTitle title="Mis datos" subtitle="Si algo está mal, escríbenos y lo corregimos." />

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
          <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500">Perfil personal</h2>
          <dl className="mt-4">
            <Field label="Código de cliente" value={customer.code} />
            <Field label="Nombre" value={customer.name} />
            <Field label="Correo" value={customer.email} />
            <Field label="Teléfono" value={customer.phone} />
          </dl>
        </section>

        <section className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
          <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500">Cuenta empresa</h2>
          {company ? (
            <>
              <p className="mt-3 inline-block rounded-full bg-brand-blue-light px-3 py-1 text-xs font-bold text-brand-blue-dark">
                {company.code} · {company.role === 'encargado' ? 'Encargado de la cuenta' : 'Miembro'}
              </p>
              <dl className="mt-4">
                <Field label="Razón social" value={company.razon_social} />
                <Field label="RUT" value={company.rut} />
                <Field label="Giro" value={company.giro} />
                <Field label="Dirección" value={[company.direccion, company.comuna, company.ciudad].filter(Boolean).join(', ')} />
                <Field label="Correo de facturación" value={company.email_facturacion} />
              </dl>
            </>
          ) : customer.is_company && (customer.company_name || customer.company_rut) ? (
            <dl className="mt-4">
              <Field label="Razón social" value={customer.company_name} />
              <Field label="RUT" value={customer.company_rut} />
            </dl>
          ) : (
            <p className="mt-4 text-sm text-slate-500">
              No tienes una empresa asociada. Si necesitas factura a nombre de una empresa, escríbenos y la asociamos a tu cuenta.
            </p>
          )}
        </section>
      </div>

      {bankData.available && (
        <section className="mt-6 max-w-xl rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
          <h2 className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500">Cuenta bancaria</h2>
          <BankDataBox bank={bankData.bank} />
          <p className="mt-3 text-xs text-slate-500">A esta cuenta te transferimos tus créditos de referidos cuando pidas un retiro.</p>
        </section>
      )}

      {hasPassword !== null && (
        <section className="mt-6 max-w-xl rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
          <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500">Clave de acceso</h2>
          <PasswordBox hasPassword={hasPassword} />
        </section>
      )}
    </main>
  )
}
