'use client'

import { useState } from 'react'
import { DRIVER_NOTE_MAX_LENGTH, type DriverNote } from '@/lib/driverNotesTypes'

interface DriverJobNotesProps {
  /** Token del link por camión. Sin token, la ruta usa la sesión personal del trabajador. */
  token?: string
  bookingId: string
  initialNotes: DriverNote[]
  /** Con qué nombre firma quien está mirando: sus notas (misma firma) se pueden editar. */
  authorLabel?: string
}

function horaCorta(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleString('es-CL', {
    timeZone: 'America/Santiago',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Notas del trabajo realizado, escritas por el chofer desde su link.
 *
 * Cada nota es una entrada aparte (en un camión puede haber más de una persona y en un
 * trabajo pasan varias cosas), y quien la escribió puede corregirla después.
 */
export default function DriverJobNotes({ token, bookingId, initialNotes, authorLabel }: DriverJobNotesProps) {
  const [notes, setNotes] = useState<DriverNote[]>(initialNotes)
  const [texto, setTexto] = useState('')
  const [abierto, setAbierto] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  /** Nota que se está corrigiendo (null = se está escribiendo una nueva). */
  const [editingId, setEditingId] = useState<string | null>(null)

  const guardar = async () => {
    const limpio = texto.trim()
    if (!limpio || guardando) return
    setGuardando(true)
    setError('')
    try {
      const res = await fetch('/api/trabajos/notes', {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, bookingId, note: limpio, ...(editingId ? { noteId: editingId } : {}) }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.note) {
        throw new Error(data?.error || 'No se pudo guardar')
      }
      const saved = data.note as DriverNote
      setNotes((prev) => (editingId ? prev.map((n) => (n.id === saved.id ? saved : n)) : [...prev, saved]))
      setTexto('')
      setAbierto(false)
      setEditingId(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="mt-3 border-t border-gray-100 pt-3">
      {notes.length > 0 && (
        <ul className="mb-2 space-y-2">
          {notes.map((n) => (
            <li key={n.id} className="rounded-lg bg-slate-50 px-3 py-2">
              <p className="whitespace-pre-line text-xs text-slate-800">{n.note}</p>
              <p className="mt-1 text-[10px] text-slate-400">
                {horaCorta(n.created_at)}
                {n.vehicle_label ? ` · ${n.vehicle_label}` : ''}
                {authorLabel && n.vehicle_label === authorLabel && editingId !== n.id && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(n.id)
                      setTexto(n.note)
                      setError('')
                      setAbierto(true)
                    }}
                    className="ml-2 font-semibold text-blue-700 underline underline-offset-2"
                  >
                    Editar
                  </button>
                )}
              </p>
            </li>
          ))}
        </ul>
      )}

      {abierto ? (
        <div>
          <textarea
            autoFocus
            rows={3}
            value={texto}
            maxLength={DRIVER_NOTE_MAX_LENGTH}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Qué pasó en el trabajo…"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-200"
          />
          {error && (
            <p className="mt-1 rounded-md bg-red-50 px-2 py-1 text-xs text-red-700">{error}</p>
          )}
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={guardar}
              disabled={guardando || !texto.trim()}
              className="rounded-lg bg-[#1B3A5C] px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {guardando ? 'Guardando…' : editingId ? 'Guardar cambios' : 'Guardar nota'}
            </button>
            <button
              type="button"
              onClick={() => {
                setAbierto(false)
                setTexto('')
                setError('')
                setEditingId(null)
              }}
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-gray-500"
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAbierto(true)}
          className="text-xs font-semibold text-blue-700 underline underline-offset-2"
        >
          {notes.length > 0 ? '+ Agregar otra nota' : '+ Agregar nota del trabajo'}
        </button>
      )}
    </div>
  )
}
