'use client'

import { useState } from 'react'
import PanelLogo from '@/components/PanelLogo'
import WorkerBankFields, { type BankForm } from './WorkerBankFields'

/**
 * Registro de un trabajador desde el link que le manda la oficina. Escribe la clave del link,
 * sus datos, su PIN y sus datos bancarios. Queda pendiente hasta que la oficina lo apruebe.
 */
/** `requirePin` = el link pide la clave que da la oficina. */
export default function WorkerSignupForm({ token, requirePin }: { token: string; requirePin: boolean }) {
  const [form, setForm] = useState({ clave: '', name: '', rut: '', phone: '', email: '', pin: '', pinRepeat: '' })
  const [bank, setBank] = useState<BankForm>({ bankCode: '', bankAccountType: '', bankAccountNumber: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (loading) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/trabajos/registro', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, ...form, ...bank }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 429) throw new Error('Demasiados intentos. Espera un rato.')
      if (!res.ok) throw new Error(data?.error || 'No pudimos registrarte.')
      setDone(data?.name || form.name)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No pudimos registrarte.')
    } finally {
      setLoading(false)
    }
  }

  const input = 'mt-1 w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base'
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: e.target.value })

  return (
    <div className="flex min-h-screen justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="rounded-2xl bg-white p-6 shadow-lg">
          <div className="mb-5 text-center">
            <PanelLogo size={64} className="mx-auto mb-3 border border-slate-100" />
            <p className="text-sm font-bold text-brand-blue-dark">Yo me encargo!</p>
            <h1 className="text-lg font-bold text-slate-900">Registro de trabajadores</h1>
          </div>

          {done ? (
            <div className="space-y-3 text-center text-sm text-slate-700">
              <p className="text-base font-semibold text-slate-900">¡Listo, {done}!</p>
              <p>Tu registro quedó enviado. La oficina lo tiene que aprobar.</p>
              <p>
                Cuando te avisen, entra a <span className="font-semibold">yomeencargo.cl/trabajos</span> con tu RUT y el PIN que elegiste.
              </p>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-3">
              {requirePin && (
                <label className="block text-sm font-medium text-gray-700">
                  Clave del link (te la da la oficina)
                  <input inputMode="numeric" autoFocus value={form.clave} onChange={set('clave')} className={input} />
                </label>
              )}
              <label className="block text-sm font-medium text-gray-700">
                Nombre y apellido
                <input autoComplete="name" value={form.name} onChange={set('name')} className={input} />
              </label>
              <label className="block text-sm font-medium text-gray-700">
                RUT
                <input value={form.rut} onChange={set('rut')} placeholder="12.345.678-9" className={input} />
              </label>
              <label className="block text-sm font-medium text-gray-700">
                Teléfono
                <input type="tel" autoComplete="tel" value={form.phone} onChange={set('phone')} placeholder="+56 9 …" className={input} />
              </label>
              <label className="block text-sm font-medium text-gray-700">
                Correo
                <input type="email" autoComplete="email" value={form.email} onChange={set('email')} className={input} />
              </label>
              <label className="block text-sm font-medium text-gray-700">
                Elige tu PIN (6 a 8 números)
                <input type="password" inputMode="numeric" autoComplete="new-password" value={form.pin} onChange={set('pin')} className={input} />
              </label>
              <label className="block text-sm font-medium text-gray-700">
                Repite tu PIN
                <input type="password" inputMode="numeric" autoComplete="new-password" value={form.pinRepeat} onChange={set('pinRepeat')} className={input} />
              </label>

              <div className="rounded-lg bg-slate-50 p-3">
                <p className="mb-2 text-sm font-semibold text-slate-900">Datos bancarios (para pagarte)</p>
                <WorkerBankFields value={bank} onChange={setBank} />
                <p className="mt-2 text-xs text-slate-500">Puedes dejarlos para después y completarlos en «Mis datos».</p>
              </div>

              {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-center text-sm text-red-700">{error}</p>}

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-lg bg-brand-green px-4 py-3 text-sm font-bold text-slate-900 transition-colors hover:bg-brand-green-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? 'Enviando…' : 'Registrarme'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
