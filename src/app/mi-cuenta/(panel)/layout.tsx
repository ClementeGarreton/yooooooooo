import { redirect } from 'next/navigation'
import { supabaseAdmin } from '@/lib/supabase'
import { requireCustomerId } from '../session'
import AccountNav from './AccountNav'
import AdminPreviewBanner from '@/components/AdminPreviewBanner'
import { getActivePreview } from '@/lib/adminPreviewServer'

export const dynamic = 'force-dynamic'

/** Marco de todas las páginas con sesión del Panel del Cliente. */
export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const customerId = await requireCustomerId()
  const { data: customer } = await supabaseAdmin
    .from('customers')
    .select('code, name, is_company, company_name, company_id')
    .eq('id', customerId)
    .maybeSingle()
  if (!customer) redirect('/mi-cuenta/ingresar')

  const name = (customer.is_company && customer.company_name) || customer.name || 'Mi cuenta'

  const preview = await getActivePreview('customer')

  return (
    <>
      {preview && <AdminPreviewBanner who={`${customer.name || 'cliente'} (${customer.code})`} />}
      <div className="min-h-screen lg:flex">
        <AccountNav name={name} code={customer.code} hasCompany={Boolean(customer.company_id)} />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </>
  )
}
