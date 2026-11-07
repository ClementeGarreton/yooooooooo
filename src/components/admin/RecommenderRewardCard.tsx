'use client'

import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'

/**
 * Créditos que gana un recomendador (conserje) por cada referido que paga su servicio.
 * Vacío = lo mismo que un cliente que recomienda (Marketing → Programa de referidos).
 */
export default function RecommenderRewardCard({ canEdit }: { canEdit: boolean }) {
  const [data, setData] = useState<{ available: boolean; reward: { kind: 'monto' | 'porcentaje'; value: number } | null; label: string | null; clients: string } | null>(null)
  const [kind, setKind] = useState<'monto' | 'porcentaje'>('monto')
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/settings/recomendadores')
    const body = await res.json().catch(() => null)
    if (res.ok && body) {
      setData(body)
      setKind(body.reward?.kind || 'monto')
      setValue(body.reward ? String(body.reward.value).replace('.', ',') : '')
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const save = async (v: string | null) => {
    setBusy(true)
    try {
      const res = await fetch('/api/admin/settings/recomendadores', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, value: v }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || 'No se pudo guardar')
      toast.success(v === null ? 'Ganan lo mismo que los clientes' : 'Premio guardado')
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo guardar')
    } finally {
      setBusy(false)
    }
  }

  if (!data) return null
  return (
    <Card className="p-6">
      <h3 className="text-lg font-semibold">Créditos de recomendadores (conserjes)</h3>
      <p className="mt-1 text-sm text-gray-600">
        {data.label ? `Ganan ${data.label}.` : `Ganan lo mismo que un cliente que recomienda: ${data.clients}.`} Se suma cuando el referido paga su
        servicio; 1 crédito = $1 y lo cobran por transferencia desde «Mi cuenta».
      </p>
      {!data.available && <p className="mt-2 text-sm text-amber-700">Falta correr la migración add_pendientes_oct.sql.</p>}
      {canEdit && data.available && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select value={kind} onChange={(e) => setKind(e.target.value as 'monto' | 'porcentaje')} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm">
            <option value="monto">Monto fijo ($ por referido pagado)</option>
            <option value="porcentaje">Porcentaje (% de lo que paga el referido)</option>
          </select>
          <input
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(e.target.value.replace(/[^\d.,]/g, ''))}
            placeholder={kind === 'monto' ? 'Ej: 10.000' : 'Ej: 10'}
            className="w-32 rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
          />
          <Button size="sm" disabled={busy || !value} onClick={() => save(value)}>
            Guardar
          </Button>
          {data.reward && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => save(null)}>
              Igual que los clientes
            </Button>
          )}
        </div>
      )}
      <p className="mt-2 text-xs text-gray-500">Cambiarlo vale para los referidos que se paguen desde ahora; lo ya ganado no cambia.</p>
    </Card>
  )
}
