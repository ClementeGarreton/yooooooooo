'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import DocumentUploader from '@/components/documents/DocumentUploader'
import type { WorkerDelivery } from '@/lib/companyClosingTypes'

/**
 * Entrega de un trabajo de empresa que se cierra por pallets o kilos (Monfiza): el
 * trabajador anota, en orden, la cantidad, el N° de OD, el N° de guía o factura y sube una
 * foto de la recepción. Con eso la oficina hace el cierre de la empresa.
 *
 * En un trabajo del servicio «Pallets» el N° de guía de despacho o de factura es obligatorio
 * para finalizar (se sabe al retirar). Si la empresa no se cierra por unidad, se piden solo
 * los pallets y ese número (la foto es opcional).
 */
export default function WorkerJobDelivery({ bookingId, initial }: { bookingId: string; initial: WorkerDelivery }) {
  const router = useRouter()
  const [unit, setUnit] = useState<'pallets' | 'kg'>(initial.unit)
  const isPallets = unit === 'pallets'
  // Servicio de pallets sin cierre por unidad: solo pallets y guía.
  const simple = Boolean(initial.palletService && !initial.closesByUnit)
  const [form, setForm] = useState({
    amount: String((initial.unit === 'pallets' ? initial.pallets : initial.kg) ?? ''),
    odNumber: initial.odNumber,
    guideNumber: initial.guideNumber,
  })
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const done = simple
    ? form.guideNumber.trim() !== ''
    : form.amount !== '' && form.odNumber.trim() !== '' && form.guideNumber.trim() !== '' && initial.photos > 0

  const save = async () => {
    if (saving) return
    setSaving(true)
    setMessage(null)
    try {
      const res = await fetch('/api/trabajos/entrega', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookingId,
          unit,
          [isPallets ? 'pallets' : 'kg']: form.amount === '' ? null : form.amount.replace(',', '.'),
          ...(simple ? {} : { odNumber: form.odNumber }),
          guideNumber: form.guideNumber,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || 'No pudimos guardar la entrega.')
      setMessage({ ok: true, text: 'Entrega guardada.' })
      router.refresh()
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : 'No pudimos guardar la entrega.' })
    } finally {
      setSaving(false)
    }
  }

  const input = 'mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-base'
  return (
    <div className={`mt-3 rounded-lg border p-3 ${done ? 'border-green-200 bg-green-50' : 'border-amber-200 bg-amber-50'}`}>
      <p className="text-sm font-bold text-gray-900">
        Entrega para {initial.company} {done ? '· completa' : '· por completar'}
      </p>
      <div className="mt-2 space-y-2">
        {!simple && (
        <div className="flex gap-2" role="group" aria-label="Pallets o kilos">
          {(['pallets', 'kg'] as const).map((u) => (
            <button
              key={u}
              type="button"
              onClick={() => {
                setUnit(u)
                setForm({ ...form, amount: String((u === 'pallets' ? initial.pallets : initial.kg) ?? '') })
              }}
              className={`flex-1 rounded-lg border px-3 py-2 text-sm font-semibold ${unit === u ? 'border-[#2C5282] bg-[#2C5282] text-white' : 'border-gray-300 bg-white text-gray-700'}`}
            >
              {u === 'pallets' ? 'Por pallets' : 'Por kilos'}
            </button>
          ))}
        </div>
        )}
        <label className="block text-sm font-medium text-gray-700">
          1. {isPallets ? 'Pallets entregados' : 'Kilos entregados'}
          <input
            inputMode={isPallets ? 'numeric' : 'decimal'}
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: isPallets ? e.target.value.replace(/\D/g, '') : e.target.value.replace(/[^\d.,]/g, '') })}
            className={input}
          />
        </label>
        {!simple && (
          <label className="block text-sm font-medium text-gray-700">
            2. N° de OD
            <input value={form.odNumber} maxLength={40} onChange={(e) => setForm({ ...form, odNumber: e.target.value })} className={input} />
          </label>
        )}
        <label className="block text-sm font-medium text-gray-700">
          {simple ? '2' : '3'}. {initial.palletService ? 'N° de guía de despacho o de factura' : 'N° de guía o factura'}
          {initial.palletService && <span className="font-semibold text-red-700"> (obligatorio para finalizar)</span>}
          <input
            value={form.guideNumber}
            maxLength={40}
            required={initial.palletService}
            onChange={(e) => setForm({ ...form, guideNumber: e.target.value })}
            className={input}
          />
        </label>
        <button
          type="button"
          disabled={saving}
          onClick={save}
          className="w-full rounded-lg bg-[#2C5282] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {saving ? 'Guardando…' : 'Guardar entrega'}
        </button>
        {message && <p className={`text-sm ${message.ok ? 'text-green-700' : 'text-red-700'}`}>{message.text}</p>}
      </div>
      <div className="mt-3">
        <p className="text-sm font-medium text-gray-700">
          {simple ? '3. Foto de la recepción (opcional)' : '4. Foto de la recepción'} {initial.photos > 0 ? `(${initial.photos} subida${initial.photos === 1 ? '' : 's'})` : ''}
        </p>
        <DocumentUploader
          ticketsUrl="/api/trabajos/documentos/subir"
          confirmUrl="/api/trabajos/documentos/confirmar"
          extra={{ bookingId, purpose: 'recepcion' }}
          title="Subir foto"
          hint="Foto de la guía firmada o de la recepción."
          kinds={[{ value: 'foto', label: 'Foto de la recepción' }]}
        />
      </div>
    </div>
  )
}
