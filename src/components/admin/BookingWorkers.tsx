'use client'

import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import type { Worker } from '@/lib/workers'

/**
 * Cuadrilla de una reserva: qué trabajadores van. A los marcados les aparece el trabajo en
 * su panel (`/trabajos`), además de los de su camión habitual. Se crean en la pestaña Flota.
 */
export default function BookingWorkers({
  bookingId,
  onChange,
}: {
  bookingId: string
  /** Se llama después de guardar un cambio en la cuadrilla. */
  onChange?: () => void
}) {
  const [workers, setWorkers] = useState<Worker[] | null>(null)
  const [assigned, setAssigned] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    setWorkers(null)
    setError(false)
    fetch(`/api/admin/bookings/${bookingId}/workers`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data) => {
        if (cancelled) return
        setWorkers(data.workers || [])
        setAssigned(data.assigned || [])
      })
      .catch(() => !cancelled && setError(true))
    return () => {
      cancelled = true
    }
  }, [bookingId])

  const toggle = async (workerId: string) => {
    if (saving) return
    const previous = assigned
    const next = assigned.includes(workerId) ? assigned.filter((id) => id !== workerId) : [...assigned, workerId]
    setAssigned(next)
    setSaving(true)
    try {
      const res = await fetch(`/api/admin/bookings/${bookingId}/workers`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workerIds: next }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'No se pudo guardar la cuadrilla')
      setAssigned(data.assigned || next)
      onChange?.()
    } catch (e) {
      setAssigned(previous)
      toast.error(e instanceof Error ? e.message : 'No se pudo guardar la cuadrilla')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-lg border border-gray-200 p-4">
      <label className="mb-1 block text-sm font-medium text-gray-900">Cuadrilla</label>
      {error ? (
        <p className="text-sm text-red-600">No se pudo cargar la cuadrilla.</p>
      ) : workers === null ? (
        <p className="text-sm text-gray-500">Cargando…</p>
      ) : workers.length === 0 ? (
        <p className="text-sm text-gray-500">No hay trabajadores creados. Se agregan en la pestaña Flota.</p>
      ) : (
        <>
          <p className="mb-2 text-xs text-gray-500">
            A quien marques le aparece este trabajo en su panel. El chofer del camión asignado ya lo ve.
          </p>
          <div className="flex flex-wrap gap-2">
            {workers.map((w) => {
              const on = assigned.includes(w.id)
              return (
                <button
                  key={w.id}
                  type="button"
                  disabled={saving}
                  onClick={() => toggle(w.id)}
                  className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-60 ${
                    on
                      ? 'border-primary-600 bg-primary-600 text-white'
                      : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400'
                  }`}
                >
                  {w.name}
                  {!w.active && ' (desactivado)'}
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
