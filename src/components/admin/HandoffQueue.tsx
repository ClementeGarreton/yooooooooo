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

export default function HandoffQueue() {
  const [rows, setRows] = useState<Handoff[]>([])
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
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
          {rows.map(row => <button key={row.id} type="button" onClick={() => setSelected(row.id)}
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
