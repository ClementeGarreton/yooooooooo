'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import type { JobTask, JobTasksData } from '@/lib/jobTaskTypes'

/**
 * Tareas por camión o por trabajador: cosas por hacer que no son una reserva («cambiar el
 * aceite», «pasar a buscar las cajas»). Al trabajador le aparecen en su agenda de /trabajos
 * (las suyas y las de su camión habitual) y las puede marcar hechas.
 */

const chileDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date())
const fmtDate = (d: string) => d.split('-').reverse().join('-')
const fmtStamp = (iso: string) =>
  new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))

/** «v:3» = camión 3; «w:<uuid>» = trabajador. */
type Target = string

export default function JobTasks() {
  const [data, setData] = useState<JobTasksData | null>(null)
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [target, setTarget] = useState<Target>('')
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/jobs/tasks')
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || 'No se pudieron cargar las tareas')
      setData(body)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudieron cargar las tareas')
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const create = async () => {
    if (saving) return
    if (!title.trim()) return toast.error('Escribe qué hay que hacer.')
    if (!target) return toast.error('Elige un camión o un trabajador.')
    setSaving(true)
    try {
      const [kind, id] = [target.slice(0, 1), target.slice(2)]
      const res = await fetch('/api/admin/jobs/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          notes,
          dueDate: dueDate || null,
          ...(kind === 'w' ? { workerId: id } : { vehicleId: Number(id) }),
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || 'No se pudo guardar la tarea')
      setData((prev) => prev && { ...prev, tasks: [...prev.tasks, body.task] })
      setTitle('')
      setNotes('')
      setDueDate('')
      toast.success('Tarea creada')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo guardar la tarea')
    } finally {
      setSaving(false)
    }
  }

  const toggle = async (task: JobTask) => {
    if (busyId) return
    setBusyId(task.id)
    try {
      const res = await fetch(`/api/admin/jobs/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ done: !task.doneAt }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || 'No se pudo guardar')
      setData((prev) => prev && { ...prev, tasks: prev.tasks.map((t) => (t.id === task.id ? body.task : t)) })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo guardar')
    } finally {
      setBusyId(null)
    }
  }

  const remove = async (task: JobTask) => {
    if (busyId || !window.confirm(`¿Borrar la tarea «${task.title}»?`)) return
    setBusyId(task.id)
    try {
      const res = await fetch(`/api/admin/jobs/tasks/${task.id}`, { method: 'DELETE' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || 'No se pudo borrar')
      setData((prev) => prev && { ...prev, tasks: prev.tasks.filter((t) => t.id !== task.id) })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo borrar')
    } finally {
      setBusyId(null)
    }
  }

  /** Pendientes agrupadas por camión o trabajador; las hechas, aparte y al final. */
  const groups = useMemo(() => {
    const open = (data?.tasks || []).filter((t) => !t.doneAt)
    const map = new Map<string, { label: string; kind: 'Camión' | 'Trabajador'; tasks: JobTask[] }>()
    for (const t of open) {
      const key = t.workerId ? `w:${t.workerId}` : `v:${t.vehicleId}`
      const entry = map.get(key) || { label: t.assignee, kind: t.workerId ? ('Trabajador' as const) : ('Camión' as const), tasks: [] }
      entry.tasks.push(t)
      map.set(key, entry)
    }
    return Array.from(map.values()).sort((a, b) => a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label))
  }, [data])
  const done = useMemo(() => (data?.tasks || []).filter((t) => t.doneAt), [data])

  if (!data) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary-600" />
      </div>
    )
  }

  if (!data.available) {
    return <Card className="p-6 text-sm text-amber-800">Falta correr la migración add_tareas.sql para usar las tareas.</Card>
  }

  const today = chileDate()

  return (
    <div className="space-y-6">
      <p className="text-gray-600">
        Cosas por hacer para un camión o una persona. Le aparecen en su panel de trabajos (las del camión, a todos los que lo tienen como camión habitual) y las marcan hechas ahí.
      </p>

      <Card className="space-y-3 p-4">
        <p className="text-sm font-bold text-gray-900">Nueva tarea</p>
        <div className="grid gap-3 md:grid-cols-[2fr_1fr_1fr]">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            placeholder="Qué hay que hacer"
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          <select value={target} onChange={(e) => setTarget(e.target.value)} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
            <option value="">Para quién…</option>
            <optgroup label="Camión">
              {data.vehicles.map((v) => (
                <option key={v.id} value={`v:${v.id}`}>
                  {v.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="Trabajador">
              {data.workers
                .filter((w) => w.active)
                .map((w) => (
                  <option key={w.id} value={`w:${w.id}`}>
                    {w.name}
                  </option>
                ))}
            </optgroup>
          </select>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            title="Para cuándo (opcional)"
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={2000}
          rows={2}
          placeholder="Notas (opcional)"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
        <div className="flex justify-end">
          <Button size="sm" onClick={create} disabled={saving}>
            {saving ? 'Guardando…' : 'Agregar tarea'}
          </Button>
        </div>
      </Card>

      {groups.length === 0 ? (
        <Card className="p-6 text-sm text-gray-500">No hay tareas pendientes.</Card>
      ) : (
        groups.map((g) => (
          <Card key={`${g.kind}-${g.label}`} className="overflow-hidden p-0">
            <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-4 py-2 text-sm">
              <span className="font-bold text-gray-800">
                {g.label} <span className="font-normal text-gray-500">· {g.kind}</span>
              </span>
              <span className="text-xs font-semibold text-gray-600">{g.tasks.length} pendiente{g.tasks.length === 1 ? '' : 's'}</span>
            </div>
            <ul className="divide-y divide-gray-100">
              {g.tasks.map((t) => (
                <TaskRow key={t.id} task={t} today={today} busy={busyId === t.id} onToggle={toggle} onRemove={remove} />
              ))}
            </ul>
          </Card>
        ))
      )}

      {done.length > 0 && (
        <Card className="overflow-hidden p-0">
          <div className="border-b border-gray-100 bg-gray-50 px-4 py-2 text-sm font-bold text-gray-500">Hechas en los últimos 7 días</div>
          <ul className="divide-y divide-gray-100">
            {done.map((t) => (
              <TaskRow key={t.id} task={t} today={today} busy={busyId === t.id} onToggle={toggle} onRemove={remove} showAssignee />
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}

function TaskRow({
  task,
  today,
  busy,
  onToggle,
  onRemove,
  showAssignee,
}: {
  task: JobTask
  today: string
  busy: boolean
  onToggle: (t: JobTask) => void
  onRemove: (t: JobTask) => void
  showAssignee?: boolean
}) {
  const late = !task.doneAt && task.dueDate !== null && task.dueDate < today
  return (
    <li className="flex items-start gap-3 px-4 py-2.5">
      <input
        type="checkbox"
        checked={Boolean(task.doneAt)}
        disabled={busy}
        onChange={() => onToggle(task)}
        aria-label={task.doneAt ? 'Marcar pendiente' : 'Marcar hecha'}
        className="mt-1 h-4 w-4 shrink-0"
      />
      <div className="min-w-0 flex-1">
        <p className={`text-sm font-semibold ${task.doneAt ? 'text-gray-400 line-through' : 'text-gray-900'}`}>{task.title}</p>
        {task.notes && <p className="whitespace-pre-line text-xs text-gray-600">{task.notes}</p>}
        <p className="mt-0.5 text-xs text-gray-500">
          {[
            showAssignee ? task.assignee : null,
            task.dueDate ? <span key="d" className={late ? 'font-semibold text-red-700' : undefined}>{`para el ${fmtDate(task.dueDate)}${late ? ' · atrasada' : ''}`}</span> : null,
            task.doneAt ? `hecha ${fmtStamp(task.doneAt)}${task.doneBy ? ` por ${task.doneBy}` : ''}` : null,
            task.createdBy ? `creada por ${task.createdBy}` : null,
          ]
            .filter(Boolean)
            .map((part, i) => (
              <span key={i}>
                {i > 0 ? ' · ' : ''}
                {part}
              </span>
            ))}
        </p>
      </div>
      <button
        type="button"
        onClick={() => onRemove(task)}
        disabled={busy}
        className="shrink-0 text-xs font-semibold text-red-600 hover:underline disabled:opacity-50"
      >
        Borrar
      </button>
    </li>
  )
}
