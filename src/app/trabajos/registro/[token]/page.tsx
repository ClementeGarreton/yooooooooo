import type { Metadata } from 'next'
import { checkSignupToken } from '@/lib/workerSignup'
import WorkerSignupForm from '@/components/trabajos/WorkerSignupForm'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Registro de trabajadores', robots: { index: false, follow: false } }

/** Registro de un trabajador con el link que comparte la oficina (Flota y equipo). */
export default async function WorkerSignupPage({ params }: { params: { token: string } }) {
  const { valid, requirePin } = await checkSignupToken(params.token)
  if (!valid) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="max-w-sm rounded-2xl bg-white p-6 text-center shadow-lg">
          <h1 className="text-lg font-bold text-slate-900">Este link ya no sirve</h1>
          <p className="mt-2 text-sm text-slate-600">Pide un link de registro nuevo en la oficina.</p>
        </div>
      </div>
    )
  }
  return <WorkerSignupForm token={params.token} requirePin={requirePin} />
}
