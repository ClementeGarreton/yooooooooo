'use client'

import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'

/**
 * Valor de la UF (Tomás, 21-10-2026: «lugar en el sistema donde actualizar el valor de la
 * UF»). Puesto a mano, es el que usan el cierre de empresas y la facturación en UF; vacío, se
 * usa el publicado ese día.
 */

interface UfData {
  available: boolean
  value: number | null
  updatedBy: string | null
  updatedAt: string | null
  today: string
  ofDay: number | null
}

const fmtUf = (n: number) => `$${n.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default function UfSettingCard({ canEdit }: { canEdit: boolean }) {
  const [data, setData] = useState<UfData | null>(null)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/settings/uf')
    const body = await res.json().catch(() => null)
    if (res.ok && body) {
      setData(body)
      setInput(body.value ? String(body.value).replace('.', ',') : '')
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const save = async (value: string | null) => {
    setBusy(true)
    try {
      const res = await fetch('/api/admin/settings/uf', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || 'No se pudo guardar la UF')
      toast.success(value === null ? 'Se usa la UF del día' : 'UF guardada')
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo guardar la UF')
    } finally {
      setBusy(false)
    }
  }

  if (!data) return null

  return (
    <Card className="p-6">
      <h3 className="text-lg font-semibold">Valor UF</h3>
      {!data.available ? (
        <p className="mt-2 text-sm text-amber-700">Falta correr la migración add_pendientes_oct.sql para poner la UF a mano.</p>
      ) : (
        <>
          <p className="mt-1 text-sm text-gray-600">
            {data.value
              ? `Se usa la UF puesta a mano: ${fmtUf(data.value)}${data.updatedBy ? ` (la puso ${data.updatedBy})` : ''}.`
              : 'Se usa la UF publicada cada día.'}{' '}
            UF de hoy ({data.today.split('-').reverse().join('-')}): {data.ofDay ? fmtUf(data.ofDay) : 'no disponible'}.
          </p>
          <p className="mt-1 text-xs text-gray-500">La usan el cierre de empresas con tarifa en UF y la facturación de esas reservas.</p>
          {canEdit && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input
                inputMode="decimal"
                value={input}
                onChange={(e) => setInput(e.target.value.replace(/[^\d.,]/g, ''))}
                placeholder="Ej: 39.500,25"
                className="w-40 rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
              />
              <Button size="sm" disabled={busy || !input} onClick={() => save(input)}>
                Usar este valor
              </Button>
              {data.value && (
                <Button size="sm" variant="outline" disabled={busy} onClick={() => save(null)}>
                  Volver a la UF del día
                </Button>
              )}
            </div>
          )}
        </>
      )}
    </Card>
  )
}
