'use client'

import { useCallback, useEffect, useState } from 'react'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Modal from '@/components/ui/Modal'
import { Gauge } from 'lucide-react'
import toast from 'react-hot-toast'
import type { VehicleKm } from '@/lib/fleetKmTypes'

/**
 * Ficha de cada camión (pestaña Flota): patente, marca y kilometraje. El kilometraje tiene
 * dos números: la LECTURA del tablero, cargada a mano con su fecha, y el ESTIMADO de hoy,
 * que le suma los kilómetros de los trabajos hechos desde esa lectura. El estimado queda
 * corto (ver fleetKm.ts): cargar una lectura nueva lo corrige.
 */

const km = (n: number) => `${n.toLocaleString('es-CL')} km`
const fmtDate = (d: string | null) => (d ? d.slice(0, 10).split('-').reverse().join('-') : '')

export default function FleetOdometerCard() {
  const [vehicles, setVehicles] = useState<VehicleKm[]>([])
  const [available, setAvailable] = useState(true)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<VehicleKm | null>(null)
  const [form, setForm] = useState({ plate: '', brand: '', odometerKm: '' })
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/fleet-km')
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'No se pudo cargar el kilometraje')
      setVehicles(data.vehicles || [])
      setAvailable(data.available !== false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo cargar el kilometraje')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const open = (v: VehicleKm) => {
    setEditing(v)
    setForm({ plate: v.plate || '', brand: v.brand || '', odometerKm: v.odometerKm !== null ? String(v.odometerKm) : '' })
  }

  const save = async () => {
    if (!editing || busy) return
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/fleet-km/${editing.vehicleId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plate: form.plate, brand: form.brand, odometerKm: form.odometerKm === '' ? null : Number(form.odometerKm) }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'No se pudo guardar')
      toast.success('Ficha del camión guardada')
      setEditing(null)
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo guardar')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="p-6">
      <h3 className="flex items-center gap-2 text-lg font-bold text-gray-900">
        <Gauge className="h-5 w-5 text-gray-600" /> Patente, marca y kilometraje
      </h3>
      <p className="text-sm text-gray-600">
        Carga lo que marca el tablero; desde esa fecha el panel suma los kilómetros de cada trabajo del camión.
      </p>

      {!available && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Falta correr la migración <code>database/migrations/add_vehicle_details.sql</code> para guardar patente, marca y
          kilometraje. Mientras tanto se ve solo la suma de los trabajos.
        </p>
      )}

      {loading ? (
        <p className="mt-4 text-sm text-gray-500">Cargando…</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="text-left text-xs font-medium uppercase tracking-wider text-gray-500">
              <tr>
                <th className="py-2 pr-4">Camión</th>
                <th className="py-2 pr-4">Patente y marca</th>
                <th className="py-2 pr-4 text-right">Última lectura</th>
                <th className="py-2 pr-4 text-right">Trabajos desde entonces</th>
                <th className="py-2 pr-4 text-right">Estimado hoy</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {vehicles.map((v) => (
                <tr key={v.vehicleId}>
                  <td className="py-2 pr-4">
                    <span className="font-semibold text-gray-900">{v.name}</span>
                    <span className="block text-xs text-gray-500">
                      {[v.driver, v.status === 'maintenance' ? 'En mantención' : null].filter(Boolean).join(' · ')}
                    </span>
                  </td>
                  <td className="py-2 pr-4">
                    <span className="font-mono font-semibold text-gray-900">{v.plate || '—'}</span>
                    <span className="block text-xs text-gray-500">{v.brand || 'Sin marca'}</span>
                  </td>
                  <td className="py-2 pr-4 text-right">
                    {v.odometerKm !== null ? (
                      <>
                        <span className="font-semibold text-gray-900">{km(v.odometerKm)}</span>
                        <span className="block text-xs text-gray-500">el {fmtDate(v.odometerAt)}</span>
                      </>
                    ) : (
                      <span className="text-gray-400">Sin lectura</span>
                    )}
                  </td>
                  <td className="py-2 pr-4 text-right">
                    <span className="font-semibold text-gray-900">+{km(v.jobsKm)}</span>
                    <span className="block text-xs text-gray-500">
                      {v.jobsCount} trabajo{v.jobsCount === 1 ? '' : 's'} · {v.jobsWithDistance} con distancia
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-right font-bold text-gray-900">
                    {v.estimatedKm !== null ? km(v.estimatedKm) : <span className="font-normal text-gray-400">—</span>}
                  </td>
                  <td className="py-2 text-right">
                    <Button size="sm" variant="outline" disabled={!available} onClick={() => open(v)}>
                      Editar
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 text-xs text-gray-500">
        El estimado queda corto: cada trabajo suma solo la distancia origen → destino de su cotización (sin ir desde la
        base, volver ni las paradas), y las reservas cargadas a mano no tienen distancia. Para corregirlo, carga la
        lectura real del tablero: el conteo vuelve a partir de ahí.
      </p>

      <Modal isOpen={editing !== null} onClose={() => setEditing(null)} title={editing ? `Ficha de ${editing.name}` : ''} size="md">
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Patente</label>
            <Input
              value={form.plate}
              onChange={(e) => setForm({ ...form, plate: e.target.value.toUpperCase().slice(0, 12) })}
              placeholder="ABCD12"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Marca y modelo</label>
            <Input value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Kilometraje que marca hoy el tablero</label>
            <Input
              type="text"
              inputMode="numeric"
              value={form.odometerKm}
              onChange={(e) => setForm({ ...form, odometerKm: e.target.value.replace(/\D/g, '').slice(0, 7) })}
              placeholder="Solo números, en km"
            />
            <p className="mt-1 text-xs text-gray-500">
              Si lo cambias, queda con la fecha de hoy y el estimado empieza a contar de nuevo desde ahí. Si lo dejas igual,
              no cambia nada.
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancelar
            </Button>
            <Button onClick={save} disabled={busy}>
              {busy ? 'Guardando...' : 'Guardar'}
            </Button>
          </div>
        </div>
      </Modal>
    </Card>
  )
}
