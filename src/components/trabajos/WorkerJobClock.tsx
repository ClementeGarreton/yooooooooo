'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatWorkTime, type OpenWork, type WorkLog } from '@/lib/workLogTypes'

/**
 * Inicio y fin del trabajo, marcados por el trabajador. Con otro trabajo iniciado y sin
 * finalizar no se puede iniciar este: se muestra cuál falta y, si igual necesita partir,
 * una advertencia que tiene que confirmar (queda registrado).
 */
export default function WorkerJobClock({
  bookingId,
  log,
  open,
}: {
  bookingId: string
  log: WorkLog | null
  /** El trabajo que tiene abierto, si es OTRO distinto de este. */
  open: OpenWork | null
}) {
  const router = useRouter()
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState<OpenWork | null>(null)

  async function send(action: 'iniciar' | 'finalizar', force = false) {
    if (working) return
    setWorking(true)
    setError('')
    try {
      const res = await fetch('/api/trabajos/jornada', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId, action, force }),
      })
      const body = await res.json().catch(() => ({}))
      if (res.ok) {
        setConfirming(null)
        router.refresh()
      } else if (res.status === 409 && body?.open) {
        setConfirming(body.open)
      } else {
        setError(body?.error || 'No se pudo guardar. Intenta de nuevo.')
      }
    } catch {
      setError('Sin conexión. Intenta de nuevo.')
    }
    setWorking(false)
  }

  const blocking = confirming || open

  return (
    <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
      {log?.finishedAt ? (
        <p className="text-sm text-slate-700">
          <span className="font-semibold text-emerald-700">Finalizado</span> · inicio {formatWorkTime(log.startedAt)} · fin{' '}
          {formatWorkTime(log.finishedAt)}
        </p>
      ) : log ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-slate-700">
            <span className="font-semibold text-blue-700">En curso</span> · iniciado {formatWorkTime(log.startedAt)}
          </p>
          <button
            type="button"
            onClick={() => send('finalizar')}
            disabled={working}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
          >
            {working ? 'Guardando…' : 'Finalizar trabajo'}
          </button>
        </div>
      ) : blocking ? (
        <div>
          <p className="text-sm text-amber-800">
            Tienes un trabajo sin finalizar: <span className="font-semibold">{blocking.label}</span> (iniciado{' '}
            {formatWorkTime(blocking.startedAt)}). Finalízalo antes de iniciar este.
          </p>
          {confirming ? (
            <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
              <p className="text-sm font-semibold text-amber-900">
                ¿Iniciar igual? Va a quedar registrado que partiste este trabajo con el otro sin finalizar.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => send('iniciar', true)}
                  disabled={working}
                  className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
                >
                  {working ? 'Guardando…' : 'Sí, iniciar igual'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(null)}
                  disabled={working}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700"
                >
                  Cancelar
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(blocking)}
              className="mt-2 text-sm font-semibold text-amber-800 underline underline-offset-2"
            >
              Necesito iniciar este igual
            </button>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => send('iniciar')}
          disabled={working}
          className="w-full rounded-lg bg-[#2C5282] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60"
        >
          {working ? 'Guardando…' : 'Iniciar trabajo'}
        </button>
      )}
      {error && <p className="mt-2 text-sm font-medium text-red-600">{error}</p>}
    </div>
  )
}
