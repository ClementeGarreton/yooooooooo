'use client'

import { useEffect, useState } from 'react'

type Handoff = {
  id: string
  phone: string
  channel: string
  quote_id: string | null
  customer_name: string | null
  customer_email: string | null
  reason: string | null
  details: string | null
  status: string
  created_at: string
  quote_snapshot: any
}

const PRICE_COMPONENTS = [
  ['distance', 'Distancia'], ['volume', 'Volumen'], ['packing', 'Embalaje'],
  ['stairs', 'Escaleras'], ['other', 'Otros'],
] as const

export default function HandoffQueue() {
  const [rows, setRows] = useState<Handoff[]>([])
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [adjustments, setAdjustments] = useState<Record<string, string>>({})
  const [overrideTotal, setOverrideTotal] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [reviewStatus, setReviewStatus] = useState('')
  const select = (row: Handoff) => {
    setSelected(row.id)
    const review = row.quote_snapshot?.tommyPriceReview
    setAdjustments(Object.fromEntries(PRICE_COMPONENTS.map(([key]) => [key, String(review?.adjustments?.[key] ?? 0)])))
    setOverrideTotal(review?.overrideTotal == null ? '' : String(review.overrideTotal))
    setNote(review?.note || '')
    setReviewStatus('')
  }
  async function savePriceReview() {
    if (!selected) return
    setSaving(true); setReviewStatus('')
    try {
      const body = { id:selected, adjustments:Object.fromEntries(PRICE_COMPONENTS.map(([key]) => [key, Number(adjustments[key] ?? 0)])),
        overrideTotal: overrideTotal.trim() ? Number(overrideTotal) : null, note }
      const response = await fetch('/api/admin/prospects/handoffs/price-review', {
        method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'No se pudo guardar')
      setReviewStatus('Revisión guardada. No se ha enviado un precio definitivo al cliente.')
      await load()
    } catch (error) { setReviewStatus(error instanceof Error ? error.message : 'Error guardando revisión') }
    finally { setSaving(false) }
  }
  async function load() {
    const res = await fetch('/api/admin/prospects/handoffs', { cache: 'no-store' })
    if (!res.ok) { setError('No se pudieron cargar las derivaciones. Revisa la migración.'); return }
    setRows(await res.json()); setError('')
  }
  useEffect(() => { void load() }, [])
  async function markAttended(id: string) {
    const res = await fetch('/api/admin/prospects/handoffs', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id })
    })
    if (!res.ok) { setError('No se pudo marcar la atención.'); return }
    await load()
  }
  const active = rows.find(row => row.id === selected)
  return <section className="rounded-xl border border-blue-200 bg-blue-50 p-4" aria-label="Atenciones humanas pendientes">
    <div className="mb-2 flex items-center justify-between gap-2">
      <div><h3 className="font-bold text-blue-950">Derivaciones a secretaría · {rows.length}</h3>
        <p className="text-sm text-blue-800">Teléfono, motivo y antecedentes recopilados por el asistente.</p></div>
      <button type="button" onClick={() => void load()} className="rounded border border-blue-300 px-3 py-2 text-sm">Actualizar</button>
    </div>
    {error && <p className="text-sm text-red-700">{error}</p>}
    {rows.length === 0 ? <p className="text-sm text-gray-600">No hay atenciones pendientes.</p> :
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="max-h-64 overflow-y-auto space-y-2">
          {rows.map(row => <button key={row.id} type="button" onClick={() => select(row)}
            className={`w-full rounded-lg border p-3 text-left text-sm ${selected === row.id ? 'border-blue-500 bg-white' : 'border-blue-100 bg-blue-50'}`}>
            <b>{row.customer_name || row.phone}</b> · {row.reason || 'Motivo pendiente'}
            <p className="text-xs text-gray-600">{row.phone} · {new Date(row.created_at).toLocaleString('es-CL')}</p>
          </button>)}
        </div>
        <div className="rounded-lg bg-white p-3 text-sm">
          {!active ? 'Selecciona una solicitud para consultar los antecedentes.' : <>
            <p><b>Contacto:</b> {active.customer_name || 'No informado'} · {active.phone}</p>
            {active.customer_email && <p><b>Correo:</b> {active.customer_email}</p>}
            {active.quote_id && <p><b>Cotización:</b> {active.quote_id}</p>}
            <p><b>Motivo:</b> {active.reason || 'Pendiente de respuesta'}</p>
            {active.reason === 'Cotización pendiente de revisión humana' && <div className="mt-3 space-y-3 rounded-lg border border-blue-200 bg-blue-50 p-3">
              <b>Revisión humana del precio (CLP)</b>
              <p>Precio automático preliminar: <b>{typeof active.quote_snapshot?.priceEstimateForReview === 'number'
                ? `$${active.quote_snapshot.priceEstimateForReview.toLocaleString('es-CL')}` : 'No calculable: ingresar precio final'}</b></p>
              <p className="text-xs text-blue-900">Puedes aplicar ajustes positivos o negativos por concepto, o fijar directamente el total. Esto no altera las tarifas globales.</p>
              <div className="grid grid-cols-2 gap-2">
                {PRICE_COMPONENTS.map(([key,label]) => <label key={key} className="text-xs">{label} (+/- $)
                  <input type="number" step="1" value={adjustments[key] ?? '0'}
                    onChange={event => setAdjustments(prev => ({...prev,[key]:event.target.value}))}
                    className="mt-1 w-full rounded border border-gray-300 p-2 text-sm" />
                </label>)}
              </div>
              <label className="block text-xs">Precio final manual (opcional)
                <input type="number" min="1" step="1" value={overrideTotal}
                  onChange={event => setOverrideTotal(event.target.value)}
                  className="mt-1 w-full rounded border border-gray-300 p-2 text-sm" placeholder="Sin reemplazo del total" />
              </label>
              <label className="block text-xs">Justificación de la revisión
                <textarea value={note} onChange={event => setNote(event.target.value)}
                  maxLength={1000} rows={2} className="mt-1 w-full rounded border border-gray-300 p-2 text-sm" />
              </label>
              <p><b>Precio revisado:</b> {active.quote_snapshot?.tommyPriceReview?.reviewedPrice != null
                ? `$${Number(active.quote_snapshot.tommyPriceReview.reviewedPrice).toLocaleString('es-CL')}` : 'Pendiente'}</p>
              <button type="button" disabled={saving} onClick={() => void savePriceReview()}
                className="rounded bg-blue-700 px-3 py-2 text-white disabled:opacity-40">Guardar revisión</button>
              {reviewStatus && <p className="text-xs">{reviewStatus}</p>}
              <p className="text-xs text-blue-900">La aprobación y comunicación definitiva al cliente son tareas humanas.</p>
            </div>}
            <p className="whitespace-pre-wrap"><b>Mensaje:</b> {active.details || 'El cliente aún no lo indicó'}</p>
            {active.quote_snapshot && Object.keys(active.quote_snapshot).length > 0 && <details className="mt-2">
              <summary className="cursor-pointer font-semibold">Ficha de cotización disponible</summary>
              <pre className="mt-2 max-h-56 overflow-auto rounded bg-gray-50 p-2 text-xs">{JSON.stringify(active.quote_snapshot, null, 2)}</pre>
            </details>}
            <button type="button" onClick={() => void markAttended(active.id)} className="mt-3 rounded bg-blue-700 px-3 py-2 text-white">Marcar atendido</button>
          </>}
        </div>
      </div>}
  </section>
}
