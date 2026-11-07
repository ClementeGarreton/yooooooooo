'use client'

import { useEffect, useState } from 'react'
import type { HistoryEvent } from '@/lib/bookingModificationTypes'

const when = (iso: string) =>
  new Date(iso).toLocaleString('es-CL', {
    timeZone: 'America/Santiago',
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })

/**
 * Historial del servicio en el detalle de la reserva: qué se pidió, qué cambió, quién lo
 * cambió y quién lo aprobó. Solo consulta; las modificaciones en terreno van destacadas.
 */
export default function BookingHistory({ bookingId }: { bookingId: string }) {
  const [events, setEvents] = useState<HistoryEvent[] | null>(null)
  const [error, setError] = useState(false)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    let cancelled = false
    setEvents(null)
    setError(false)
    setExpanded(false)
    fetch(`/api/admin/bookings/${bookingId}/history`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data) => !cancelled && setEvents(data.events || []))
      .catch(() => !cancelled && setError(true))
    return () => {
      cancelled = true
    }
  }, [bookingId])

  const shown = events ? (expanded || events.length <= 8 ? events : events.slice(-8)) : []

  return (
    <div className="rounded-lg border border-gray-200 p-4">
      <label className="mb-2 block text-sm font-medium text-gray-900">Historial del servicio</label>
      {error ? (
        <p className="text-sm text-red-600">No se pudo cargar el historial.</p>
      ) : events === null ? (
        <p className="text-sm text-gray-500">Cargando…</p>
      ) : events.length === 0 ? (
        <p className="text-sm text-gray-500">Sin movimientos registrados.</p>
      ) : (
        <>
          {!expanded && events.length > 8 && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="mb-2 text-xs font-semibold text-primary-600 underline underline-offset-2"
            >
              Ver los {events.length - 8} anteriores
            </button>
          )}
          <ol className="space-y-2">
            {shown.map((e, i) => (
              <li
                key={`${e.at}-${i}`}
                className={`flex items-start gap-3 rounded-md px-2 py-1.5 text-sm ${
                  e.kind === 'modification' ? 'bg-amber-50' : ''
                }`}
              >
                <span
                  className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${
                    e.kind === 'modification' ? 'bg-amber-500' : 'bg-green-500'
                  }`}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-gray-900">{e.title}</p>
                  {e.detail && <p className="text-xs text-gray-600">“{e.detail}”</p>}
                  <p className="text-xs text-gray-500">{[e.by, when(e.at)].filter(Boolean).join(' · ')}</p>
                </div>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  )
}
