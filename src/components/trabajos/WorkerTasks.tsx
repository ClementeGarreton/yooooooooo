'use client'

import { useState } from 'react'
import type { JobTask } from '@/lib/jobTaskTypes'

/**
 * Tareas del trabajador en «Por hacer»: las suyas y las de su camión habitual. Las marca
 * hechas acá; en la vista de administrador («Ver como») se muestran sin poder marcarlas.
 */

const chileDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date())
const fmtDate = (d: string) => d.split('-').reverse().join('-')

export default function WorkerTasks({ initial, readOnly }: { initial: JobTask[]; readOnly?: boolean }) {
  const [tasks, setTasks] = useState(initial)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const today = chileDate()
  const pending = tasks.filter((t) => !t.doneAt).length

  const toggle = async (task: JobTask) => {
    if (readOnly || busyId) return
    setBusyId(task.id)
    setError(null)
    try {
      const res = await fetch('/api/trabajos/tareas', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: task.id, done: !task.doneAt }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || 'No pudimos guardar. Intenta de nuevo.')
      setTasks((prev) => prev.map((t) => (t.id === task.id ? body.task : t)))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No pudimos guardar. Intenta de nuevo.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section className="mb-6 rounded-xl border border-amber-200 bg-white">
      <div className="flex items-center justify-between border-b border-amber-100 bg-amber-50 px-4 py-2">
        <h2 className="text-sm font-bold text-amber-900">Tareas</h2>
        <span className="text-xs font-semibold text-amber-800">{pending === 0 ? 'Todo hecho' : `${pending} pendiente${pending === 1 ? '' : 's'}`}</span>
      </div>
      <ul className="divide-y divide-gray-100">
        {tasks.map((t) => {
          const late = !t.doneAt && t.dueDate !== null && t.dueDate < today
          return (
            <li key={t.id}>
              <label className={`flex items-start gap-3 px-4 py-3 ${readOnly ? '' : 'cursor-pointer'}`}>
                <input
                  type="checkbox"
                  checked={Boolean(t.doneAt)}
                  disabled={readOnly || busyId === t.id}
                  onChange={() => toggle(t)}
                  className="mt-0.5 h-5 w-5 shrink-0"
                />
                <span className="min-w-0 flex-1">
                  <span className={`block text-sm font-semibold ${t.doneAt ? 'text-gray-400 line-through' : 'text-gray-900'}`}>{t.title}</span>
                  {t.notes && <span className="block whitespace-pre-line text-xs text-gray-600">{t.notes}</span>}
                  <span className="mt-0.5 block text-xs text-gray-500">
                    {t.workerId ? 'Para ti' : `Para el ${t.assignee}`}
                    {t.dueDate && <span className={late ? 'font-semibold text-red-700' : undefined}>{` · para el ${fmtDate(t.dueDate)}${late ? ' · atrasada' : ''}`}</span>}
                    {t.doneAt && t.doneBy ? ` · hecha por ${t.doneBy.split(' · ')[0]}` : ''}
                  </span>
                </span>
              </label>
            </li>
          )
        })}
      </ul>
      {error && <p className="px-4 pb-3 text-xs font-semibold text-red-700">{error}</p>}
    </section>
  )
}
