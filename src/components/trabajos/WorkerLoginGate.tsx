'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import PanelLogo from '@/components/PanelLogo'
import { clearOfflineCache } from '@/components/trabajos/OfflineSupport'

/** Entrada del trabajador a `/trabajos`: su RUT y su PIN personal (los crea el admin en Flota). */
export default function WorkerLoginGate() {
  const router = useRouter()
  const [rut, setRut] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // Sin sesión (venció o es otra persona): lo guardado para el modo sin conexión no se queda.
  useEffect(() => {
    clearOfflineCache()
  }, [])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!rut.trim() || !pin.trim() || loading) return

    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/trabajos/entrar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rut, pin }),
      })
      if (res.ok) {
        // La cookie ya quedó puesta: recargamos para que el servidor pinte la agenda.
        router.refresh()
        return
      }
      if (res.status === 429) {
        setError('Demasiados intentos. Espera unos minutos.')
      } else {
        const data = await res.json().catch(() => ({}))
        setError(data?.error || 'RUT o PIN incorrecto')
      }
      setPin('')
    } catch {
      setError('No se pudo verificar. Revisa tu conexión.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-xs">
        <div className="rounded-2xl bg-white p-6 shadow-lg">
          <div className="mb-5 text-center">
            <PanelLogo size={64} className="mx-auto mb-3 border border-slate-100" />
            <p className="text-sm font-bold text-brand-blue-dark">Yo me encargo!</p>
            <h1 className="text-lg font-bold text-slate-900">Trabajos por hacer</h1>
            <p className="mt-1 text-sm text-gray-500">Entra con tu RUT y tu PIN</p>
          </div>

          <form onSubmit={submit} className="space-y-3">
            <input
              type="text"
              autoComplete="username"
              autoFocus
              value={rut}
              onChange={(e) => setRut(e.target.value)}
              placeholder="RUT (12.345.678-9)"
              aria-label="RUT"
              className="w-full rounded-lg border border-gray-300 px-4 py-3 text-center text-base text-gray-900 focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-300"
            />
            <input
              type="password"
              inputMode="numeric"
              autoComplete="current-password"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="PIN"
              aria-label="PIN personal"
              className="w-full rounded-lg border border-gray-300 px-4 py-3 text-center text-2xl tracking-[0.3em] text-gray-900 focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-300"
            />

            {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-center text-sm text-red-700">{error}</p>}

            <button
              type="submit"
              disabled={loading || !rut.trim() || !pin.trim()}
              className="w-full rounded-lg bg-brand-green px-4 py-3 text-sm font-bold text-slate-900 transition-colors hover:bg-brand-green-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? 'Verificando…' : 'Entrar'}
            </button>
          </form>
        </div>

        <p className="mt-4 text-center text-[11px] text-gray-400">
          Yo Me Encargo · acceso del equipo. Si no tienes PIN, pídelo en la oficina.
        </p>
      </div>
    </div>
  )
}
