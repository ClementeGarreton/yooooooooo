'use client'

import { useState } from 'react'

/**
 * Descarga la orden de trabajo en PDF (sin precios), la misma que imprime la oficina.
 * Funciona en el panel del trabajador y en el link del camión (`token`).
 */
export default function WorkOrderButton({ bookingId, token }: { bookingId: string; token?: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const download = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const params = new URLSearchParams({ bookingId, ...(token ? { token } : {}) })
      const res = await fetch(`/api/trabajos/orden?${params}`)
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || 'No pudimos armar la orden de trabajo.')
      const { generateAdminQuotePDF } = await import('@/lib/adminQuotePdf')
      await generateAdminQuotePDF(body.data, { includePrices: false })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No pudimos armar la orden de trabajo.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={download}
        disabled={busy}
        className="w-full rounded-lg border border-[#2C5282] px-3 py-2 text-sm font-semibold text-[#2C5282] disabled:opacity-60"
      >
        {busy ? 'Armando el PDF…' : 'Descargar orden de trabajo (PDF)'}
      </button>
      {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
    </div>
  )
}
