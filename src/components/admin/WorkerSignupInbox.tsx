'use client'

import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import { formatRut } from '@/lib/rut'
import type { PendingWorker } from '@/lib/workerSignup'

/**
 * Por aprobar → Trabajadores nuevos: quienes se registraron por el link de registro.
 * Aprobar los deja entrar a /trabajos (con su camión habitual, si se elige); rechazar los
 * deja desactivados.
 */
export default function WorkerSignupInbox({ onPendingCount }: { onPendingCount?: (n: number) => void }) {
  const [pending, setPending] = useState<PendingWorker[] | null>(null)
  const [vehicles, setVehicles] = useState<{ id: number; name: string }[]>([])
  const [vehicleFor, setVehicleFor] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const [res, fleet] = await Promise.all([
        fetch('/api/admin/workers/pending'),
        fetch('/api/admin/fleet-config').then((r) => r.json()).catch(() => null),
      ])
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || 'No se pudieron cargar los registros')
      setPending(body.pending || [])
      onPendingCount?.((body.pending || []).length)
      setVehicles(Array.isArray(fleet?.vehicles) ? fleet.vehicles.map((v: any) => ({ id: v.id, name: v.name || `Camión ${v.id}` })) : [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudieron cargar los registros')
    }
  }, [onPendingCount])

  useEffect(() => {
    load()
  }, [load])

  const decide = async (p: PendingWorker, approve: boolean) => {
    if (busy) return
    if (!approve && !window.confirm(`¿Rechazar el registro de ${p.name}? Queda desactivado y no puede entrar.`)) return
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/workers/${p.id}/approval`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approve, vehicle_id: approve ? vehicleFor[p.id] || null : null }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error || 'No se pudo guardar')
      toast.success(approve ? `${p.name} aprobado: ya puede entrar` : 'Registro rechazado')
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo guardar')
    } finally {
      setBusy(false)
    }
  }

  if (pending === null) return null
  return (
    <Card className="p-5">
      <h3 className="text-lg font-bold text-gray-900">Trabajadores nuevos</h3>
      <p className="text-sm text-gray-600">Se registraron con el link de registro de Flota y equipo. Hasta que los apruebes no pueden entrar a /trabajos.</p>
      {pending.length === 0 ? (
        <p className="mt-3 text-sm text-gray-500">No hay registros esperando aprobación.</p>
      ) : (
        <ul className="mt-3 divide-y divide-gray-100">
          {pending.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-900">{p.name}</p>
                <p className="text-xs text-gray-500">
                  {[
                    p.code,
                    formatRut(p.rut),
                    p.phone,
                    p.email,
                    p.hasBankData ? 'con datos bancarios' : 'sin datos bancarios',
                    p.signedUpAt ? `se registró el ${new Date(p.signedUpAt).toLocaleDateString('es-CL', { timeZone: 'America/Santiago' })}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={vehicleFor[p.id] || ''}
                  onChange={(e) => setVehicleFor({ ...vehicleFor, [p.id]: e.target.value })}
                  className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                  aria-label="Camión habitual"
                >
                  <option value="">Sin camión fijo</option>
                  {vehicles.map((v) => (
                    <option key={v.id} value={String(v.id)}>
                      {v.name}
                    </option>
                  ))}
                </select>
                <Button size="sm" disabled={busy} onClick={() => decide(p, true)}>
                  Aprobar
                </Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => decide(p, false)}>
                  Rechazar
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
