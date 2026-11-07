'use client'

import { useState } from 'react'

/** Crear o cambiar la clave de acceso, desde «Mis datos». */
export default function PasswordBox({ hasPassword }: { hasPassword: boolean }) {
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [has, setHas] = useState(hasPassword)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setError('')
    setDone(false)
    if (password !== repeat) return setError('Las dos claves no son iguales.')
    setBusy(true)
    try {
      const res = await fetch('/api/cuenta/clave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'No pudimos guardar tu clave.')
      setDone(true)
      setHas(true)
      setPassword('')
      setRepeat('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No pudimos guardar tu clave.')
    } finally {
      setBusy(false)
    }
  }

  const inputClass = 'mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 focus:border-brand-blue-dark focus:outline-none'

  return (
    <form onSubmit={submit} className="mt-4 space-y-3">
      <p className="text-sm text-slate-600">
        {has
          ? 'Ya tienes una clave. Puedes cambiarla cuando quieras.'
          : 'Todavía no tienes clave: créala para entrar con tu correo sin esperar un link.'}
      </p>
      <label className="block">
        <span className="text-xs font-bold uppercase tracking-wide text-slate-500">{has ? 'Clave nueva' : 'Clave'} (mínimo 8 caracteres)</span>
        <input type="password" required minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} />
      </label>
      <label className="block">
        <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Repítela</span>
        <input type="password" required minLength={8} autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} className={inputClass} />
      </label>
      {error && <p className="text-sm font-semibold text-red-600">{error}</p>}
      {done && <p className="text-sm font-semibold text-green-700">Clave guardada.</p>}
      <button type="submit" disabled={busy} className="rounded-xl bg-brand-green px-5 py-2.5 font-bold text-white hover:opacity-90 disabled:opacity-60">
        {busy ? 'Guardando…' : has ? 'Cambiar clave' : 'Crear clave'}
      </button>
    </form>
  )
}
