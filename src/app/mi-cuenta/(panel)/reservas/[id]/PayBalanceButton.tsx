'use client'

import { useState } from 'react'
import { clp } from '../../../format'

/** «Pagar saldo con Flow» (Módulo 1, paso 5). El monto lo fija el servidor. */
export default function PayBalanceButton({ bookingId, pending }: { bookingId: string; pending: number }) {
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')

  async function pay() {
    setWorking(true)
    setError('')
    try {
      const res = await fetch(`/api/cuenta/reservas/${bookingId}/pagar-saldo`, { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (res.ok && body?.paymentUrl) {
        window.location.href = body.paymentUrl
        return
      }
      setError(body?.error || 'No pudimos crear el pago. Intenta de nuevo.')
    } catch {
      setError('No pudimos conectarnos. Revisa tu conexión e intenta de nuevo.')
    }
    setWorking(false)
  }

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={pay}
        disabled={working}
        className="w-full rounded-lg bg-brand-green px-4 py-3 font-bold text-slate-900 hover:bg-brand-green-hover disabled:opacity-60"
      >
        <span className="block">{working ? 'Creando el pago…' : 'Pagar saldo con Flow'}</span>
        <span className="block text-xl">{clp(pending)}</span>
      </button>
      {error && <p className="mt-2 text-sm font-medium text-red-600">{error}</p>}
    </div>
  )
}
