'use client'

import { useEffect, useState } from 'react'
import { sanitizeQuoteState } from '@/lib/quoteState'
import type { PricingConfig } from '@/lib/pricingService'

type Key = 'pricePerCubicMeter' | 'pricePerKilometer' | 'packing' | 'disassembly' | 'assembly'
type Override = Partial<Record<Key, number>>
const labels: Record<Key, string> = {
  pricePerCubicMeter: 'Precio por m³', pricePerKilometer: 'Precio por km',
  packing: 'Embalaje', disassembly: 'Desarmado', assembly: 'Armado'
}
const keys = Object.keys(labels) as Key[]
type Prospect = { id: string; total_price?: number; adjusted_price?: number; total_volume?: number;
  total_distance?: number; additional_services?: Record<string, any>; quote_state?: unknown;
  price_review?: { overrides?: Override; components?: Record<string, number>; original?: number; reviewed?: number }
}
export default function ProspectPriceReview({ prospect, onSaved }: {
  prospect: Prospect; onSaved: (updated: Prospect) => void
}) {
  const [pricing, setPricing] = useState<PricingConfig | null>(null)
  const [overrides, setOverrides] = useState<Record<Key, string>>({pricePerCubicMeter:'',pricePerKilometer:'',packing:'',disassembly:'',assembly:''})
  const [comment, setComment] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    setPricing(null); setError('')
    setOverrides({pricePerCubicMeter:'',pricePerKilometer:'',packing:'',disassembly:'',assembly:''})
    fetch('/api/admin/pricing-config', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(setPricing).catch(() => setPricing(null))
  }, [prospect.id])
  const state = sanitizeQuoteState(prospect.quote_state)
  const rates: Record<Key, number> | null = pricing ? {
    pricePerCubicMeter: pricing.pricePerCubicMeter,
    pricePerKilometer: pricing.pricePerKilometer,
    packing: pricing.additionalServices.packing,
    disassembly: pricing.additionalServices.disassembly,
    assembly: pricing.additionalServices.assembly
  } : null
  const detail = prospect.price_review?.components
  async function save() {
    const payload: Override = {}
    for (const key of keys) {
      if (!overrides[key].trim()) continue
      const n = Number(overrides[key])
      if (!Number.isFinite(n) || n < 0) { setError(`Valor inválido: ${labels[key]}`); return }
      payload[key] = n
    }
    setSaving(true); setError('')
    try {
      const response = await fetch('/api/admin/prospects/price-review', {
        method:'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prospectId: prospect.id, overrides: payload, comment })
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'No se pudo guardar')
      onSaved(data.prospect)
    } catch (error) { setError(error instanceof Error ? error.message : 'Error de revisión') }
    finally { setSaving(false) }
  }
  return <section className="rounded-lg border border-amber-200 bg-amber-50 p-4">
    <h4 className="font-bold">Revisión humana del valor estimativo</h4>
    <p className="mb-3 text-xs text-amber-900">Precio calculado: ${Number(prospect.total_price || 0).toLocaleString('es-CL')} ·
      Ajustado: ${Number(prospect.adjusted_price ?? prospect.total_price ?? 0).toLocaleString('es-CL')}. No es precio definitivo hasta revisión.</p>
    {!state?.items.length ? <p className="text-xs text-amber-900">No hay inventario detallado guardado. Puedes ajustar el total con la opción «Ajustar cotización».</p> : <>
      <div className="grid grid-cols-2 gap-2 text-xs md:grid-cols-3">
        <div><b>Volumen</b><p>{Number(prospect.total_volume || 0).toFixed(2)} m³</p></div>
        <div><b>Distancia</b><p>{Number(prospect.total_distance || 0).toFixed(1)} km</p></div>
        <div><b>Objetos</b><p>{state.items.length} líneas</p></div>
      </div>
      {prospect.price_review?.overrides && <p className="mt-3 text-xs text-amber-900">Últimos ajustes: {Object.entries(prospect.price_review.overrides).map(([key, value]) => `${labels[key as Key]}: $${Number(value).toLocaleString('es-CL')}`).join(' · ') || 'sin cambios'}</p>}
      {detail && <details className="my-3 rounded bg-white p-2 text-xs"><summary className="cursor-pointer font-semibold">Desglose de la última revisión</summary>
        {Object.entries(detail).map(([key,value]) => <p key={key}>{key}: {value}</p>)}
      </details>}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {keys.map(key => <label key={key} className="text-xs font-semibold">
          {labels[key]} · tarifa global ${Number(rates?.[key] || 0).toLocaleString('es-CL')}
          <input type="number" min="0" step="1" placeholder="Sin cambio" value={overrides[key]}
            onChange={e => setOverrides(prev => ({...prev,[key]:e.target.value}))}
            className="mt-1 w-full rounded border border-gray-300 bg-white px-3 py-2" />
        </label>)}
      </div>
      <textarea rows={2} className="mt-3 w-full rounded border border-gray-300 bg-white p-2 text-sm"
        placeholder="Motivo del ajuste (opcional)" value={comment} onChange={e=>setComment(e.target.value)} />
      {error && <p className="text-sm text-red-700">{error}</p>}
      <button type="button" disabled={!pricing || saving}
        onClick={() => void save()} className="rounded bg-amber-700 px-3 py-2 text-sm text-white disabled:opacity-50">
        {saving ? 'Guardando…' : 'Recalcular y guardar revisión'}
      </button>
      <p className="mt-2 text-xs text-gray-600">Los ajustes solo afectan esta cotización; no cambian las tarifas globales.</p>
    </>}
  </section>
}
