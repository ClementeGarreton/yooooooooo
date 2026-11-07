'use client'

import { useState } from 'react'
import PanelLogo from '@/components/PanelLogo'

const inputClass = 'mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 focus:border-brand-blue focus:outline-none'
const labelClass = 'block text-sm font-semibold text-slate-700'

const EMPTY = {
  razon_social: '',
  rut: '',
  giro: '',
  direccion: '',
  comuna: '',
  ciudad: '',
  email_facturacion: '',
  name: '',
  email: '',
  phone: '',
  clave: '',
}

/**
 * Formulario de registro de empresas. Al terminar no queda esperando: le llega el correo con
 * el link de acceso y puede ir directo a «Ingresar» (Tomás, 21-10-2026).
 */
export default function CompanySignupForm({ token, requirePin }: { token: string; requirePin: boolean }) {
  const [form, setForm] = useState({ ...EMPTY })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<{ email: string } | null>(null)
  const set = (key: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: e.target.value })

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/cuenta/registro-empresa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, token }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || 'No pudimos registrar la empresa.')
      setDone({ email: body.email })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No pudimos registrar la empresa.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-lg">
        <div className="rounded-2xl bg-white p-6 shadow-lg">
          <div className="mb-5 text-center">
            <PanelLogo size={64} className="mx-auto mb-3 border border-slate-100" />
            <p className="text-sm font-bold text-brand-blue-dark">Yo me encargo!</p>
            <h1 className="text-lg font-bold text-slate-900">Registro de empresas</h1>
          </div>

          {done ? (
            <div className="space-y-4 text-center text-sm text-slate-700">
              <p className="text-base font-semibold text-slate-900">¡Listo, la empresa quedó registrada!</p>
              <p>
                Te enviamos a <span className="font-semibold">{done.email}</span> un correo con el link para entrar a tu cuenta. Si no
                llega en unos minutos, revisa el spam o pide otro link desde «Ingresar».
              </p>
              <a href="/mi-cuenta/ingresar" className="inline-block rounded-xl bg-brand-green px-5 py-3 font-bold text-slate-900">
                Ir a ingresar
              </a>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <p className="text-sm font-bold uppercase tracking-wide text-slate-500">La empresa</p>
              <label className={labelClass}>
                Razón social
                <input required value={form.razon_social} onChange={set('razon_social')} maxLength={200} className={inputClass} />
              </label>
              <label className={labelClass}>
                RUT de la empresa
                <input required value={form.rut} onChange={set('rut')} placeholder="76.123.456-7" className={inputClass} />
              </label>
              <label className={labelClass}>
                Giro (opcional)
                <input value={form.giro} onChange={set('giro')} maxLength={200} className={inputClass} />
              </label>
              <div className="grid gap-3 sm:grid-cols-3">
                <label className={`${labelClass} sm:col-span-3`}>
                  Dirección (opcional)
                  <input value={form.direccion} onChange={set('direccion')} maxLength={200} className={inputClass} />
                </label>
                <label className={labelClass}>
                  Comuna
                  <input value={form.comuna} onChange={set('comuna')} maxLength={100} className={inputClass} />
                </label>
                <label className={`${labelClass} sm:col-span-2`}>
                  Ciudad
                  <input value={form.ciudad} onChange={set('ciudad')} maxLength={100} className={inputClass} />
                </label>
              </div>
              <label className={labelClass}>
                Correo para facturas (opcional)
                <input type="email" value={form.email_facturacion} onChange={set('email_facturacion')} className={inputClass} />
              </label>

              <p className="pt-2 text-sm font-bold uppercase tracking-wide text-slate-500">Tus datos (encargado de la cuenta)</p>
              <label className={labelClass}>
                Nombre
                <input required value={form.name} onChange={set('name')} maxLength={120} className={inputClass} />
              </label>
              <label className={labelClass}>
                Correo (con él entras a tu cuenta)
                <input required type="email" value={form.email} onChange={set('email')} className={inputClass} />
              </label>
              <label className={labelClass}>
                Teléfono (opcional)
                <input type="tel" value={form.phone} onChange={set('phone')} maxLength={30} className={inputClass} />
              </label>
              {requirePin && (
                <label className={labelClass}>
                  Clave del link
                  <input required inputMode="numeric" value={form.clave} onChange={set('clave')} maxLength={8} className={inputClass} />
                </label>
              )}

              {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</p>}
              <button type="submit" disabled={busy} className="w-full rounded-xl bg-brand-green px-4 py-3 font-bold text-slate-900 disabled:opacity-60">
                {busy ? 'Registrando…' : 'Registrar empresa'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
