'use client'

import { useState } from 'react'
import PanelLogo from '@/components/PanelLogo'

type Mode = 'clave' | 'primera' | 'link'

const inputClass = 'mt-1 w-full rounded-lg border border-slate-300 px-4 py-3 focus:border-brand-blue focus:outline-none'
const labelClass = 'text-sm font-semibold text-slate-700'

/**
 * Ingreso al Panel del Cliente. Tres formas (ver customerPassword.ts):
 *  - Con mi clave: correo + clave.
 *  - Es mi primera vez: correo + RUT + la clave que quiere usar. Solo mientras la cuenta
 *    no tenga clave y con el RUT que confirmó el equipo.
 *  - Link al correo: sin clave; también sirve para recuperarla. El mensaje de éxito es el
 *    mismo exista o no la cuenta, por eso dice «si ese correo tiene cotizaciones».
 */
export default function IngresarPage() {
  const [mode, setMode] = useState<Mode>('clave')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [rut, setRut] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  const pick = (next: Mode) => {
    setMode(next)
    setError('')
    setSent(false)
    setPassword('')
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const [url, body] =
        mode === 'clave'
          ? ['/api/cuenta/clave/entrar', { email, password }]
          : mode === 'primera'
            ? ['/api/cuenta/clave/primera-vez', { email, rut, password }]
            : ['/api/cuenta/acceso', { email }]
      const res = await fetch(url as string, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        if (mode === 'link') setSent(true)
        else window.location.href = '/mi-cuenta'
        return
      }
      const data = await res.json().catch(() => ({}))
      setError(
        res.status === 429
          ? 'Demasiados intentos. Espera unos minutos.'
          : data?.error || 'No pudimos completar el ingreso. Intenta de nuevo.'
      )
    } catch {
      setError('No pudimos conectarnos. Revisa tu conexión e intenta de nuevo.')
    } finally {
      setBusy(false)
    }
  }

  const tab = (id: Mode, label: string) => (
    <button
      type="button"
      onClick={() => pick(id)}
      aria-pressed={mode === id}
      className={`flex-1 rounded-lg px-2 py-2 text-sm font-bold ${
        mode === id ? 'bg-white text-brand-blue-dark shadow-sm' : 'text-slate-500'
      }`}
    >
      {label}
    </button>
  )

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-lg">
        <div className="flex items-center gap-3">
          <PanelLogo size={52} className="border border-slate-100" />
          <p className="text-sm font-bold text-brand-blue-dark">Yo me encargo!</p>
        </div>
        <h1 className="mt-4 text-2xl font-bold text-slate-900">Entrar a mi cuenta</h1>

        <div className="mt-5 flex gap-1 rounded-xl bg-slate-100 p-1">
          {tab('clave', 'Con mi clave')}
          {tab('primera', 'Primera vez')}
          {tab('link', 'Link al correo')}
        </div>

        {mode === 'link' && sent ? (
          <div className="mt-6 rounded-xl bg-brand-blue-light p-4 text-slate-700">
            <p className="font-semibold text-slate-900">Revisa tu correo</p>
            <p className="mt-2 text-sm">
              Si <strong>{email}</strong> tiene cotizaciones o reservas con nosotros, te enviamos un
              link para entrar. Vence en 15 minutos y sirve una sola vez.
            </p>
            <button
              type="button"
              onClick={() => setSent(false)}
              className="mt-4 text-sm font-semibold text-brand-blue-dark underline"
            >
              Usar otro correo
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-6 space-y-4">
            <p className="text-sm text-slate-600">
              {mode === 'clave' && 'Escribe el correo que usaste al cotizar y tu clave.'}
              {mode === 'primera' &&
                'Si ya fuiste cliente, entra con tu correo y tu RUT y crea tu clave. Desde ahí entras siempre con ella.'}
              {mode === 'link' &&
                'Te enviamos un link de acceso al correo que usaste al cotizar. Sirve también si olvidaste tu clave.'}
            </p>
            <label className="block">
              <span className={labelClass}>Correo</span>
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputClass}
                placeholder="tu@correo.cl"
              />
            </label>
            {mode === 'primera' && (
              <label className="block">
                <span className={labelClass}>RUT</span>
                <input
                  required
                  value={rut}
                  onChange={(e) => setRut(e.target.value)}
                  className={inputClass}
                  placeholder="12.345.678-9"
                />
              </label>
            )}
            {mode !== 'link' && (
              <label className="block">
                <span className={labelClass}>{mode === 'primera' ? 'Crea tu clave (mínimo 8 caracteres)' : 'Clave'}</span>
                <input
                  type="password"
                  required
                  minLength={mode === 'primera' ? 8 : undefined}
                  autoComplete={mode === 'primera' ? 'new-password' : 'current-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={inputClass}
                />
              </label>
            )}
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-lg bg-brand-green px-4 py-3 font-bold text-slate-900 hover:bg-brand-green-hover disabled:opacity-60"
            >
              {busy
                ? 'Un momento…'
                : mode === 'clave'
                  ? 'Entrar'
                  : mode === 'primera'
                    ? 'Crear mi clave y entrar'
                    : 'Enviarme un link de acceso'}
            </button>
            {mode !== 'link' && (
              <button type="button" onClick={() => pick('link')} className="w-full text-sm font-semibold text-brand-blue-dark underline">
                {mode === 'clave' ? 'Olvidé mi clave' : 'No me funciona: enviarme un link al correo'}
              </button>
            )}
          </form>
        )}
      </div>
    </main>
  )
}
