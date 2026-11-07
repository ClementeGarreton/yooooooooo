'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import PanelLogo from '@/components/PanelLogo'
import { clearOfflineCache } from '@/components/trabajos/OfflineSupport'

interface DriverPinGateProps {
  token: string
  /** Camión al que pertenece el link ("Camión 2 · Pedro"), para que el chofer
   *  confirme antes de escribir el PIN que está en el link correcto. */
  label?: string
}

export default function DriverPinGate({ token, label }: DriverPinGateProps) {
  const router = useRouter()
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // Sin PIN puesto: no se deja guardado lo de una sesión anterior.
  useEffect(() => {
    clearOfflineCache()
  }, [])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!pin.trim() || loading) return

    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/trabajos/verify-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin, token }),
      })

      if (res.ok) {
        // La cookie ya quedó puesta: recargamos para que el server component
        // renderice los trabajos.
        router.refresh()
        return
      }

      if (res.status === 429) {
        setError('Demasiados intentos. Espera unos minutos.')
      } else {
        const data = await res.json().catch(() => ({}))
        setError(data?.error || 'PIN incorrecto')
      }
      setPin('')
    } catch {
      setError('No se pudo verificar. Revisa tu conexión.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-xs">
        <div className="rounded-2xl bg-white p-6 shadow-lg">
          <div className="mb-5 text-center">
            <PanelLogo size={64} className="mx-auto mb-3 border border-slate-100" />
            <p className="text-sm font-bold text-brand-blue-dark">Yo me encargo!</p>
            <h1 className="text-lg font-bold text-slate-900">Trabajos por hacer</h1>
            {label && <p className="mt-1 text-sm font-semibold text-gray-700">{label}</p>}
            <p className="mt-1 text-sm text-gray-500">Ingresa el PIN para ver los trabajos</p>
          </div>

          <form onSubmit={submit} className="space-y-3">
            <input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              autoFocus
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="••••"
              aria-label="PIN de acceso"
              className="w-full rounded-lg border border-gray-300 px-4 py-3 text-center text-2xl tracking-[0.4em] text-gray-900 focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-300"
            />

            {error && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-center text-sm text-red-700">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading || !pin.trim()}
              className="w-full rounded-lg bg-brand-green px-4 py-3 text-sm font-bold text-slate-900 transition-colors hover:bg-brand-green-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? 'Verificando…' : 'Entrar'}
            </button>
          </form>
        </div>

        <p className="mt-4 text-center text-[11px] text-gray-400">
          Yo Me Encargo · acceso para choferes
        </p>
      </div>
    </div>
  )
}
