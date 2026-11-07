'use client'

import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

/**
 * Destino del link del correo. Abrir esta página NO gasta el link: el canje es el POST
 * del botón. Los antivirus de correo abren los links para revisarlos, y si el GET
 * canjeara, el cliente llegaría a un link ya usado (ver customerLogin.ts, punto 3).
 */
function Entrar() {
  const router = useRouter()
  const token = useSearchParams().get('t') || ''
  const [state, setState] = useState<'idle' | 'working' | 'error'>('idle')
  const [error, setError] = useState('')

  async function enter() {
    setState('working')
    setError('')
    try {
      const res = await fetch('/api/cuenta/entrar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      if (res.ok) {
        router.replace('/mi-cuenta')
        return
      }
      const body = await res.json().catch(() => ({}))
      setError(body?.error || 'No pudimos abrir tu cuenta.')
      setState('error')
    } catch {
      setError('No pudimos conectarnos. Revisa tu conexión e intenta de nuevo.')
      setState('error')
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-lg">
        <p className="text-sm font-bold text-brand-blue-dark">Yo me encargo!</p>
        <h1 className="mt-4 text-2xl font-bold text-slate-900">Tu cuenta te espera</h1>

        {!token ? (
          <p className="mt-4 text-sm text-slate-600">
            Este link está incompleto.{' '}
            <a href="/mi-cuenta/ingresar" className="font-semibold text-brand-blue-dark underline">
              Pide uno nuevo
            </a>
            .
          </p>
        ) : state === 'error' ? (
          <div className="mt-4 space-y-4">
            <p className="text-sm text-red-600">{error}</p>
            <a
              href="/mi-cuenta/ingresar"
              className="inline-block rounded-lg bg-brand-green px-6 py-3 font-bold text-slate-900 hover:bg-brand-green-hover"
            >
              Pedir un link nuevo
            </a>
          </div>
        ) : (
          <button
            type="button"
            onClick={enter}
            disabled={state === 'working'}
            className="mt-6 w-full rounded-lg bg-brand-green px-4 py-3 font-bold text-slate-900 hover:bg-brand-green-hover disabled:opacity-60"
          >
            {state === 'working' ? 'Entrando…' : 'Entrar a mi cuenta'}
          </button>
        )}
      </div>
    </main>
  )
}

export default function EntrarPage() {
  return (
    <Suspense fallback={null}>
      <Entrar />
    </Suspense>
  )
}
