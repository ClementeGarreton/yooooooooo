'use client'

import { useState } from 'react'
import type { OwnPayClosing } from '@/lib/workerPay'

const day = (d: string) => d.slice(0, 10).split('-').reverse().join('-')
const clp = (n: number) => `$${Math.round(n).toLocaleString('es-CL')}`

/**
 * «Mis pagos» del trabajador: sus períodos cerrados y el PDF con el detalle de cada uno, el
 * mismo que descarga la oficina en Cierre de pagos. El PDF se arma en el teléfono.
 */
export default function WorkerPayDownloads({ closings, readOnly = false }: { closings: OwnPayClosing[]; readOnly?: boolean }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const download = async (id: string) => {
    setBusy(id)
    setError(null)
    try {
      const res = await fetch(`/api/trabajos/pagos/${id}`)
      const data = await res.json().catch(() => null)
      if (!res.ok || !data) throw new Error(data?.error || 'No pudimos armar el detalle.')
      const { downloadStatementsPdf } = await import('@/lib/payStatementExport')
      downloadStatementsPdf([data])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No pudimos armar el detalle.')
    } finally {
      setBusy(null)
    }
  }

  if (closings.length === 0) {
    return <p className="mt-5 rounded-xl bg-white p-4 text-sm text-slate-500 shadow-sm">Todavía no hay períodos cerrados. Cuando la oficina cierre uno, aparece acá.</p>
  }

  return (
    <div className="mt-5 space-y-3">
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {closings.map((c) => (
        <div key={c.id} className="flex items-center justify-between gap-3 rounded-xl bg-white p-4 shadow-sm">
          <div>
            <p className="font-semibold text-slate-900">
              {day(c.from)} al {day(c.to)}
            </p>
            <p className="text-sm text-slate-500">
              Total {clp(c.total)} · cerrado el {day(c.closedAt)}
            </p>
          </div>
          <button
            type="button"
            onClick={() => download(c.id)}
            disabled={readOnly || busy !== null}
            className="shrink-0 rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy === c.id ? 'Armando…' : 'Descargar PDF'}
          </button>
        </div>
      ))}
    </div>
  )
}
