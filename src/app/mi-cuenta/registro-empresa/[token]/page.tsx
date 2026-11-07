import type { Metadata } from 'next'
import { checkCompanySignupToken } from '@/lib/companySignup'
import CompanySignupForm from './CompanySignupForm'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Registro de empresas', robots: { index: false, follow: false } }

/** Registro de una empresa con el link que comparte Yo Me Encargo (Empresas → Link de registro). */
export default async function CompanySignupPage({ params }: { params: { token: string } }) {
  const { valid, requirePin } = await checkCompanySignupToken(params.token)
  if (!valid) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="max-w-sm rounded-2xl bg-white p-6 text-center shadow-lg">
          <h1 className="text-lg font-bold text-slate-900">Este link ya no sirve</h1>
          <p className="mt-2 text-sm text-slate-600">Pídele un link de registro nuevo a Yo Me Encargo.</p>
        </div>
      </div>
    )
  }
  return <CompanySignupForm token={params.token} requirePin={requirePin} />
}
