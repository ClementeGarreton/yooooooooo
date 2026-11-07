'use client'

import { useCallback, useEffect, useState } from 'react'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import Modal from '@/components/ui/Modal'
import { HardHat, Plus } from 'lucide-react'
import toast from 'react-hot-toast'
import { formatRut, isValidRut } from '@/lib/rut'
import type { Worker } from '@/lib/workers'
import { WORKER_ROLES, WORKER_ROLE_LABEL, isFieldRole, type WorkerRole } from '@/lib/workerRoles'
import WorkerSignupPanel from './WorkerSignupPanel'
import { openPreview } from './openPreview'
import { siteUrl } from '@/lib/siteUrl'

/**
 * Trabajadores (pestaña Flota). Cada uno entra a `/trabajos` con su RUT y un PIN personal
 * y ve los trabajos de su camión habitual más los que se le asignen en cada reserva.
 * Cada uno tiene su categoría: chofer o peoneta van a terreno; administrativo, contador o
 * externo no tienen camión ni se asignan a trabajos, pero se les paga desde Finanzas.
 * El PIN se escribe acá y no se puede volver a ver: si se olvida, se le pone uno nuevo.
 */

interface VehicleOption {
  id: number
  name: string
  driver?: string
}

// Sin categoría por defecto: hay que elegirla (Tomás, 27-10-2026: la secretaria quedó «en terreno»
// y aparecía al programar).
const EMPTY = { name: '', rut: '', phone: '', email: '', vehicle_id: '', role: '' as WorkerRole | '', pin: '' }
type WorkerForm = typeof EMPTY

const PIN_RE = /^\d{6,8}$/

async function api(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.error || 'No se pudo completar la acción')
  return data
}

interface WorkerComment {
  id: string
  comment: string
  created_by: string | null
  created_at: string
}

/**
 * Comentarios internos de la ficha («se entrega carta de amonestación», «disponible de lunes
 * a miércoles»). Es un historial con fecha y autor; el trabajador no lo ve.
 */
function WorkerComments({ workerId }: { workerId: string }) {
  const [comments, setComments] = useState<WorkerComment[] | null>(null)
  const [available, setAvailable] = useState(true)
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    setComments(null)
    fetch(`/api/admin/workers/${workerId}/comments`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return
        setAvailable(data?.available !== false)
        setComments(data?.comments || [])
      })
      .catch(() => !cancelled && setComments([]))
    return () => {
      cancelled = true
    }
  }, [workerId])

  const add = async () => {
    if (!text.trim() || saving) return
    setSaving(true)
    try {
      const res = await fetch(`/api/admin/workers/${workerId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment: text }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'No se pudo guardar el comentario')
      setComments((prev) => [data.comment, ...(prev || [])])
      setText('')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo guardar el comentario')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-lg border border-gray-200 p-4">
      <p className="text-sm font-medium text-gray-900">Comentarios</p>
      <p className="mb-2 text-xs text-gray-500">Notas internas con fecha y autor. El trabajador no las ve.</p>
      {!available ? (
        <p className="text-sm text-amber-800">
          Falta correr la migración <code>database/migrations/add_worker_comments.sql</code>.
        </p>
      ) : (
        <>
          <div className="flex gap-2">
            <Input
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={1000}
              placeholder="Ej.: se entrega carta de amonestación · disponible de lunes a miércoles"
            />
            <Button size="sm" onClick={add} disabled={saving || !text.trim()}>
              Agregar
            </Button>
          </div>
          {comments === null ? (
            <p className="mt-2 text-sm text-gray-500">Cargando…</p>
          ) : comments.length === 0 ? (
            <p className="mt-2 text-sm text-gray-500">Sin comentarios todavía.</p>
          ) : (
            <ul className="mt-3 max-h-48 space-y-2 overflow-y-auto">
              {comments.map((c) => (
                <li key={c.id} className="rounded-lg bg-gray-50 px-3 py-2">
                  <p className="whitespace-pre-line text-sm text-gray-800">{c.comment}</p>
                  <p className="mt-0.5 text-xs text-gray-500">
                    {new Date(c.created_at).toLocaleString('es-CL', { timeZone: 'America/Santiago', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    {c.created_by ? ` · ${c.created_by}` : ''}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}

export default function WorkersCard() {
  const [workers, setWorkers] = useState<Worker[]>([])
  const [vehicles, setVehicles] = useState<VehicleOption[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  /** null = cerrado, 'new' = alta, o el trabajador que se edita. */
  const [editing, setEditing] = useState<Worker | 'new' | null>(null)
  const [form, setForm] = useState<WorkerForm>({ ...EMPTY })
  // Quienes se registraron por el link y esperan aprobación: van en su propia lista.
  const [pendingIds, setPendingIds] = useState<string[]>([])
  const onPending = useCallback((ids: string[]) => setPendingIds(ids), [])
  const listed = workers.filter((w) => !pendingIds.includes(w.id))

  const load = useCallback(async () => {
    try {
      const [workersData, fleet] = await Promise.all([
        api('/api/admin/workers', 'GET'),
        api('/api/admin/fleet-config', 'GET').catch(() => null),
      ])
      setWorkers(workersData.workers || [])
      setVehicles(Array.isArray(fleet?.vehicles) ? fleet.vehicles : [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al cargar trabajadores')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const vehicleLabel = (id: number | null) => {
    const v = vehicles.find((x) => x.id === id)
    return v ? v.name : id === null ? 'Sin camión fijo' : `Camión ${id}`
  }

  const open = (target: Worker | 'new') => {
    setEditing(target)
    setForm(
      target === 'new'
        ? { ...EMPTY }
        : {
            name: target.name,
            rut: formatRut(target.rut),
            phone: target.phone || '',
            email: target.email || '',
            vehicle_id: target.vehicle_id === null ? '' : String(target.vehicle_id),
            role: target.role || 'terreno',
            pin: '',
          }
    )
  }

  const save = async () => {
    const isNew = editing === 'new'
    if (!form.name.trim() || !isValidRut(form.rut)) {
      toast.error('Completa el nombre y un RUT válido')
      return
    }
    if (!form.role) {
      toast.error('Elige la categoría: chofer, peoneta, administrativo…')
      return
    }
    if ((isNew || form.pin) && !PIN_RE.test(form.pin)) {
      toast.error('El PIN debe tener entre 6 y 8 dígitos')
      return
    }
    setBusy(true)
    try {
      const body = {
        name: form.name,
        rut: form.rut,
        phone: form.phone,
        email: form.email,
        vehicle_id: !isFieldRole(form.role || null) || form.vehicle_id === '' ? null : Number(form.vehicle_id),
        role: form.role,
        ...(form.pin ? { pin: form.pin } : {}),
      }
      if (isNew) await api('/api/admin/workers', 'POST', body)
      else await api(`/api/admin/workers/${(editing as Worker).id}`, 'PATCH', body)
      toast.success(isNew ? 'Trabajador creado' : 'Trabajador guardado')
      setEditing(null)
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo guardar')
    } finally {
      setBusy(false)
    }
  }

  const toggleActive = async (worker: Worker) => {
    if (worker.active && !window.confirm(`¿Desactivar a ${worker.name}? Deja de poder entrar al tiro.`)) return
    setBusy(true)
    try {
      await api(`/api/admin/workers/${worker.id}`, 'PATCH', { active: !worker.active })
      toast.success(worker.active ? 'Trabajador desactivado' : 'Trabajador reactivado')
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo cambiar')
    } finally {
      setBusy(false)
    }
  }

  const loginUrl = `${siteUrl()}/trabajos`

  return (
    <Card className="p-6">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h3 className="flex items-center gap-2 text-lg font-bold text-gray-900">
            <HardHat className="h-5 w-5 text-gray-600" /> Trabajadores
          </h3>
          <p className="text-sm text-gray-600">
            Cada persona entra con su RUT y su PIN en{' '}
            <button
              type="button"
              className="font-medium text-primary-600 underline underline-offset-2"
              onClick={() => navigator.clipboard.writeText(loginUrl).then(() => toast.success('Link copiado'))}
            >
              {loginUrl}
            </button>
          </p>
        </div>
        <Button size="sm" onClick={() => open('new')}>
          <Plus className="mr-2 h-4 w-4" /> Nuevo trabajador
        </Button>
      </div>

      <WorkerSignupPanel onPending={onPending} />

      {loading ? (
        <p className="mt-4 text-sm text-gray-500">Cargando…</p>
      ) : listed.length === 0 ? (
        <p className="mt-4 text-sm text-gray-500">
          Todavía no hay trabajadores con acceso personal. Los links por camión siguen funcionando.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-gray-100">
          {listed.map((w) => (
            <li key={w.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <div className="min-w-0">
                <p className={`text-sm font-medium ${w.active ? 'text-gray-900' : 'text-gray-400 line-through'}`}>
                  {w.name}
                </p>
                <p className="text-xs text-gray-500">
                  {[
                    w.code,
                    WORKER_ROLE_LABEL[w.role || 'terreno'],
                    formatRut(w.rut),
                    w.phone,
                    w.email,
                    isFieldRole(w.role) ? vehicleLabel(w.vehicle_id) : null,
                    w.active ? null : 'Desactivado',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => openPreview({ kind: 'worker', id: w.id })}>
                  Ver su panel
                </Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => open(w)}>
                  Editar · comentarios
                </Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => toggleActive(w)}>
                  {w.active ? 'Desactivar' : 'Reactivar'}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Modal
        isOpen={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'Nuevo trabajador' : 'Editar trabajador'}
        size="lg"
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Nombre</label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">RUT (es su usuario)</label>
              <Input value={form.rut} onChange={(e) => setForm({ ...form, rut: e.target.value })} placeholder="12.345.678-9" />
              {form.rut.trim() && !isValidRut(form.rut) && (
                <p className="mt-1 text-xs text-red-600">El dígito verificador no calza.</p>
              )}
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Teléfono</label>
              <Input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Correo (para los avisos de trabajos)</label>
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="Opcional" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Categoría</label>
              <Select
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value as WorkerRole | '' })}
                options={[
                  // Uno de antes («en terreno», «secretaria») ve su valor hasta que se le elija otro.
                  ...(form.role === '' || WORKER_ROLES.some((r) => r.value === form.role)
                    ? [{ value: '', label: 'Elige la categoría' }]
                    : [{ value: form.role, label: WORKER_ROLE_LABEL[form.role] }]),
                  ...WORKER_ROLES.map((r) => ({ value: r.value, label: r.label })),
                ]}
              />
              {form.role === 'terreno' && <p className="mt-1 text-xs text-amber-700">Elige si es chofer o peoneta.</p>}
              {form.role !== '' && !isFieldRole(form.role) && (
                <p className="mt-1 text-xs text-gray-500">
                  No tiene camión ni se asigna a trabajos. Se le paga desde Finanzas → Pago a trabajadores.
                </p>
              )}
            </div>
            {form.role !== '' && isFieldRole(form.role) && (
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Camión habitual</label>
                <Select
                  value={form.vehicle_id}
                  onChange={(e) => setForm({ ...form, vehicle_id: e.target.value })}
                  options={[
                    { value: '', label: 'Sin camión fijo (solo lo que se le asigne)' },
                    ...vehicles.map((v) => ({
                      value: String(v.id),
                      label: v.driver ? `${v.name} · ${v.driver}` : v.name,
                    })),
                  ]}
                />
              </div>
            )}
            <div className="md:col-span-2">
              <label className="mb-1 block text-sm font-medium text-gray-700">
                {editing === 'new' ? 'PIN (6 a 8 dígitos)' : 'PIN nuevo (déjalo vacío para no cambiarlo)'}
              </label>
              <Input
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={form.pin}
                onChange={(e) => setForm({ ...form, pin: e.target.value.replace(/\D/g, '').slice(0, 8) })}
                placeholder="6 a 8 dígitos"
              />
              <p className="mt-1 text-xs text-gray-500">
                Anótalo y entrégaselo: después no se puede volver a ver. Cambiarlo le cierra la sesión en todos sus
                dispositivos.
              </p>
            </div>
          </div>
          {editing !== null && editing !== 'new' && <WorkerComments workerId={editing.id} />}
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
