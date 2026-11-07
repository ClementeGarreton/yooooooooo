'use client'

import { useState } from 'react'
import {
  MODIFICATION_FIELDS,
  MODIFICATION_FIELD_LABEL,
  MODIFICATION_STATUS_LABEL,
  type ModificationField,
  type WorkerModification,
} from '@/lib/bookingModificationTypes'

const STATUS_CLASS = {
  pendiente: 'bg-amber-100 text-amber-800',
  aprobada: 'bg-green-100 text-green-800',
  rechazada: 'bg-red-100 text-red-700',
} as const

const inputClass =
  'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-200'

/**
 * «Registrar diferencia»: el trabajador anota lo que encontró distinto de lo cotizado
 * (4 bultos declarados, 5 en terreno). Queda pendiente hasta que la administración la
 * aprueba; el dato cotizado no se borra. Se agregan, no se editan.
 */
export default function WorkerJobModifications({
  bookingId,
  initial,
  declaredItems,
}: {
  bookingId: string
  initial: WorkerModification[]
  /** Bultos declarados en la cotización, para precargar «Cotizado». 0 = sin detalle. */
  declaredItems: number
}) {
  const [list, setList] = useState<WorkerModification[]>(initial)
  const [open, setOpen] = useState(false)
  const [field, setField] = useState<ModificationField>('bultos')
  const [original, setOriginal] = useState(declaredItems > 0 ? String(declaredItems) : '')
  const [found, setFound] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const pickField = (value: ModificationField) => {
    setField(value)
    setOriginal(value === 'bultos' && declaredItems > 0 ? String(declaredItems) : '')
  }

  const send = async () => {
    if (saving) return
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/trabajos/modificaciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId, field, original, found, note }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.modification) throw new Error(data?.error || 'No se pudo registrar')
      setList((prev) => [...prev, data.modification as WorkerModification])
      setFound('')
      setNote('')
      setOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo registrar')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-3 border-t border-gray-100 pt-3">
      {list.length > 0 && (
        <ul className="mb-2 space-y-2">
          {list.map((m) => (
            <li key={m.id} className="rounded-lg bg-slate-50 px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold text-slate-800">
                  {MODIFICATION_FIELD_LABEL[m.field]}: {m.originalValue} → {m.foundValue}
                </p>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${STATUS_CLASS[m.status]}`}>
                  {MODIFICATION_STATUS_LABEL[m.status]}
                </span>
              </div>
              <p className="mt-0.5 whitespace-pre-line text-xs text-slate-600">{m.note}</p>
            </li>
          ))}
        </ul>
      )}

      {open ? (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {MODIFICATION_FIELDS.map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => pickField(f.value)}
                className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${
                  field === f.value ? 'border-[#1B3A5C] bg-[#1B3A5C] text-white' : 'border-gray-300 bg-white text-gray-700'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Cotizado</span>
              <input value={original} onChange={(e) => setOriginal(e.target.value)} maxLength={120} className={inputClass} />
            </label>
            <label className="block">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">En terreno</span>
              <input value={found} onChange={(e) => setFound(e.target.value)} maxLength={120} className={inputClass} />
            </label>
          </div>
          <label className="block">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Motivo</span>
            <textarea
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={1000}
              placeholder="Qué encontraste distinto y por qué"
              className={inputClass}
            />
          </label>
          <p className="rounded-lg bg-green-50 px-3 py-2 text-xs text-green-800">
            Queda pendiente hasta que la administración la apruebe. El dato cotizado no se borra.
          </p>
          {error && <p className="rounded-md bg-red-50 px-2 py-1 text-xs text-red-700">{error}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={send}
              disabled={saving || !original.trim() || !found.trim() || note.trim().length < 3}
              className="rounded-lg bg-[#1B3A5C] px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? 'Enviando…' : 'Enviar a aprobación'}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                setError('')
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
          onClick={() => setOpen(true)}
          className="text-xs font-semibold text-blue-700 underline underline-offset-2"
        >
          + Registrar diferencia con lo cotizado
        </button>
      )}
    </div>
  )
}
