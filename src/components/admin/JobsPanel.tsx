'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import { buildWhatsAppLink } from '@/lib/whatsapp'
import { UNASSIGNED_COLOR } from '@/lib/vehicleColors'
import type { AdminJob, AdminJobsData } from '@/lib/adminJobsTypes'
import PeriodFilter from './PeriodFilter'
import { periodOf, resolvePeriod, type Period } from '@/lib/period'
import JobHistory from './JobHistory'
import JobTasks from './JobTasks'
import { siteUrl } from '@/lib/siteUrl'

/**
 * Trabajos: asignación de camión y cuadrilla a cada reserva de los próximos días.
 *
 * Cada trabajo ya trae un camión (el reparto automático) y, con él, a los trabajadores que
 * lo tienen como camión habitual: ese es el default y no hay que tocar nada. Acá se
 * corrige: se cambia el camión o se suma gente puntual a la cuadrilla. Lo que se asigna le
 * aparece al trabajador en `/trabajos` y le deja un aviso en su pestaña «Avisos»; el botón
 * de WhatsApp abre el chat con el mensaje escrito (lo envía quien está en el panel).
 */

const chileDate = (offsetDays = 0) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date(Date.now() + offsetDays * 86_400_000))

const fmtDate = (d: string) => d.split('-').reverse().join('-')
const fmtStamp = (iso: string) =>
  new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
const fmtTime = (t: string | null) => (t ? t.slice(0, 5) : 'Sin hora')
const dayLabel = (d: string) => {
  const [y, m, day] = d.split('-').map(Number)
  const text = new Date(y, m - 1, day).toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' })
  return text.charAt(0).toUpperCase() + text.slice(1)
}

type Filter = 'all' | 'no-crew'

/**
 * Trabajos, en tres vistas: «Por asignar» (lo que viene, con su camión y cuadrilla),
 * «Historial» (todo lo ya realizado, para buscarlo) y «Tareas» (cosas por hacer de un
 * camión o un trabajador, que no son una reserva).
 */
export default function JobsPanel({
  onOpenBooking,
  allowed,
}: {
  onOpenBooking?: (quoteId: string) => void
  /** ¿El perfil ve esta pestaña? Sin esto, las ve todas. */
  allowed?: (section: string) => boolean
}) {
  const views = (
    [
      ['upcoming', 'Por asignar'],
      ['history', 'Historial'],
      ['tasks', 'Tareas'],
    ] as const
  ).filter(([id]) => !allowed || allowed(id))
  const [chosen, setView] = useState<'upcoming' | 'history' | 'tasks'>('upcoming')
  const view = views.some(([id]) => id === chosen) ? chosen : views[0]?.[0]
  if (!view) return <p className="text-sm text-gray-600">Tu perfil no tiene ninguna pestaña de Trabajos activa.</p>
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-bold text-gray-900">Trabajos</h2>
        <div className="flex gap-1 rounded-xl bg-gray-100 p-1 text-sm">
          {views.map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setView(id)}
              aria-pressed={view === id}
              className={`rounded-lg px-3 py-1.5 font-semibold ${view === id ? 'bg-white text-primary-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {view === 'upcoming' ? (
        <UpcomingJobs onOpenBooking={onOpenBooking} />
      ) : view === 'history' ? (
        <JobHistory onOpenBooking={onOpenBooking} />
      ) : (
        <JobTasks />
      )}
    </div>
  )
}

function UpcomingJobs({ onOpenBooking }: { onOpenBooking?: (quoteId: string) => void }) {
  // Por defecto, hoy y los 13 días siguientes: es para asignar lo que viene.
  const [period, setPeriod] = useState<Period>(() => periodOf('custom', chileDate(0), chileDate(13)))
  const range = resolvePeriod(period)
  const from = range.from || chileDate(0)
  const to = range.to || chileDate(13)
  const [data, setData] = useState<AdminJobsData | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')

  const load = useCallback(async (desde: string, hasta: string) => {
    try {
      const res = await fetch(`/api/admin/jobs?desde=${desde}&hasta=${hasta}`)
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || 'No se pudieron cargar los trabajos')
      setData(body)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudieron cargar los trabajos')
    }
  }, [])

  useEffect(() => {
    if (from && to && from <= to) load(from, to)
  }, [from, to, load])

  const workersById = useMemo(() => new Map((data?.workers || []).map((w) => [w.id, w])), [data])
  const vehiclesById = useMemo(() => new Map((data?.vehicles || []).map((v) => [v.id, v])), [data])

  /** Quiénes van: los del camión habitual + los puestos a mano. */
  const teamOf = useCallback(
    (job: AdminJob) => {
      const habitual = (data?.workers || []).filter((w) => w.active && w.vehicle_id !== null && w.vehicle_id === job.vehicleId)
      const habitualIds = new Set(habitual.map((w) => w.id))
      const extra = job.crew.filter((id) => !habitualIds.has(id)).map((id) => workersById.get(id)).filter((w): w is NonNullable<typeof w> => !!w)
      return { habitual, extra }
    },
    [data, workersById]
  )

  const save = async (job: AdminJob, payload: { vehicleId?: number | null; workerIds?: string[]; fixedTime?: boolean }) => {
    if (saving) return
    setSaving(true)
    try {
      const res = await fetch(`/api/admin/jobs/${job.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || 'No se pudo guardar la asignación')
      setData((prev) =>
        prev && {
          ...prev,
          jobs: prev.jobs.map((j) =>
            j.id === job.id
              ? {
                  ...j,
                  vehicleId: body.vehicleId !== undefined ? body.vehicleId : j.vehicleId,
                  crew: body.crew || j.crew,
                  fixedTime: body.fixedTime !== undefined ? body.fixedTime : j.fixedTime,
                }
              : j
          ),
        }
      )
      toast.success('Asignación guardada')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo guardar la asignación')
    } finally {
      setSaving(false)
    }
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary-600" />
      </div>
    )
  }

  const shown = data.jobs.filter((j) => {
    if (filter === 'all') return true
    const team = teamOf(j)
    return team.habitual.length + team.extra.length === 0
  })
  const days = Array.from(new Set(shown.map((j) => j.date)))
  const withoutTeam = data.jobs.filter((j) => {
    const team = teamOf(j)
    return team.habitual.length + team.extra.length === 0
  }).length

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="text-gray-600">
          Camión y cuadrilla de cada trabajo. Toca un trabajo para asignar; al trabajador le aparece en su panel con un aviso.
        </p>
        <PeriodFilter value={period} onChange={setPeriod} presets={['day', 'tomorrow', 'week', 'month', 'custom']} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-xl bg-gray-100 p-1 text-sm">
          {([
            ['all', `Todos (${data.jobs.length})`],
            ['no-crew', `Sin nadie asignado (${withoutTeam})`],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setFilter(id)}
              aria-pressed={filter === id}
              className={`rounded-lg px-3 py-1.5 font-semibold ${filter === id ? 'bg-white text-primary-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
            >
              {label}
            </button>
          ))}
        </div>
        {data.workers.length === 0 && (
          <p className="text-sm text-amber-700">No hay trabajadores creados: se agregan en Flota y equipo.</p>
        )}
      </div>

      {shown.length === 0 ? (
        <Card className="p-6 text-sm text-gray-500">No hay trabajos en este rango{filter === 'no-crew' ? ' sin gente asignada' : ''}.</Card>
      ) : (
        days.map((day) => (
          <Card key={day} className="overflow-hidden p-0">
            <div className="border-b border-gray-100 bg-gray-50 px-4 py-2 text-sm font-bold text-gray-800">
              {dayLabel(day)}
              {day === chileDate(0) ? ' · hoy' : ''}
            </div>
            <ul className="divide-y divide-gray-100">
              {shown
                .filter((j) => j.date === day)
                .map((job) => {
                  const vehicle = job.vehicleId !== null ? vehiclesById.get(job.vehicleId) : undefined
                  const color = vehicle?.color || UNASSIGNED_COLOR
                  const team = teamOf(job)
                  const everyone = [...team.habitual, ...team.extra]
                  const open = openId === job.id
                  const habitualIds = new Set(team.habitual.map((w) => w.id))
                  const route = [job.origin, job.destination].filter(Boolean).join(' → ')
                  return (
                    <li key={job.id} style={{ borderLeft: `4px solid ${color.hex}` }}>
                      <button
                        type="button"
                        onClick={() => setOpenId(open ? null : job.id)}
                        aria-expanded={open}
                        className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-left hover:bg-gray-50"
                      >
                        <span className="w-14 shrink-0 text-sm font-bold text-gray-900">
                          {fmtTime(job.time)}
                          {job.fixedTime && <span className="block text-[10px] font-bold uppercase text-red-700">Hora fija</span>}
                        </span>
                        <span className="min-w-0 flex-1 basis-56">
                          <span className="block truncate text-sm font-semibold text-gray-900">
                            {job.clientName || 'Sin nombre'}
                            {job.code && <span className="font-normal text-gray-500"> · {job.code}</span>}
                          </span>
                          {/* Direcciones completas: el equipo las necesita para planificar el día. */}
                          <span className="block text-xs text-gray-500">{route || 'Sin dirección'}</span>
                          <span className="mt-0.5 block text-xs font-medium text-gray-700">
                            {[
                              job.volumeM3 !== null ? `${job.volumeM3.toLocaleString('es-CL', { maximumFractionDigits: 1 })} m³` : 'sin m³',
                              job.people !== null ? `${job.people} persona${job.people === 1 ? '' : 's'}` : 'sin personas',
                            ].join(' · ')}
                          </span>
                        </span>
                        <span className="rounded-full px-2 py-0.5 text-xs font-semibold" style={{ backgroundColor: color.soft, color: color.ink }}>
                          {vehicle?.name || 'Sin camión'}
                        </span>
                        {job.work.status !== 'sin_iniciar' && (
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                              job.work.status === 'en_curso' ? 'bg-blue-100 text-blue-800' : 'bg-green-100 text-green-800'
                            }`}
                          >
                            {job.work.status === 'en_curso' ? 'En curso' : 'Finalizado'}
                          </span>
                        )}
                        <span className={`basis-48 truncate text-xs ${everyone.length === 0 ? 'font-semibold text-amber-700' : 'text-gray-600'}`}>
                          {everyone.length === 0 ? 'Nadie asignado' : everyone.map((w) => w.name).join(', ')}
                        </span>
                      </button>

                      {open && (
                        <div className="space-y-4 border-t border-gray-100 bg-gray-50/60 px-4 py-4">
                          {job.work.logs.length > 0 && (
                            <div>
                              <p className="mb-1 text-xs font-bold uppercase tracking-wide text-gray-500">Marcado por el equipo</p>
                              <ul className="space-y-0.5 text-sm text-gray-700">
                                {job.work.logs.map((l, i) => (
                                  <li key={i}>
                                    <span className="font-semibold">{l.workerLabel}</span> · inició {fmtStamp(l.startedAt)}
                                    {l.finishedAt ? ` · finalizó ${fmtStamp(l.finishedAt)}` : ' · sin finalizar'}
                                    {l.startedWithOpen && <span className="text-xs text-amber-700"> (lo inició con otro trabajo abierto)</span>}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                          <label className="flex items-center gap-2 text-sm font-semibold text-gray-800">
                            <input
                              type="checkbox"
                              checked={job.fixedTime}
                              disabled={saving}
                              onChange={(e) => save(job, { fixedTime: e.target.checked })}
                            />
                            Horario fijo de retiro o entrega (al equipo le sale una alerta)
                          </label>
                          <div>
                            <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-gray-500">Camión</label>
                            <select
                              value={job.vehicleId ?? ''}
                              disabled={saving}
                              onChange={(e) => save(job, { vehicleId: e.target.value === '' ? null : Number(e.target.value) })}
                              className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm"
                            >
                              <option value="">Sin camión (se reparte solo)</option>
                              {data.vehicles.map((v) => (
                                <option key={v.id} value={v.id} disabled={v.status === 'maintenance'}>
                                  {v.name}
                                  {v.driver ? ` · ${v.driver}` : ''}
                                  {v.status === 'maintenance' ? ' (en mantención)' : ''}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div>
                            <p className="mb-1 text-xs font-bold uppercase tracking-wide text-gray-500">Cuadrilla</p>
                            <p className="mb-2 text-xs text-gray-500">
                              Los del camión habitual ya ven el trabajo. Marca a quien más vaya a este servicio.
                            </p>
                            <div className="flex flex-wrap gap-2">
                              {data.workers.map((w) => {
                                const byTruck = habitualIds.has(w.id)
                                const on = byTruck || job.crew.includes(w.id)
                                return (
                                  <button
                                    key={w.id}
                                    type="button"
                                    disabled={saving || byTruck}
                                    title={byTruck ? 'Va por su camión habitual' : undefined}
                                    onClick={() =>
                                      save(job, {
                                        workerIds: job.crew.includes(w.id) ? job.crew.filter((id) => id !== w.id) : [...job.crew, w.id],
                                      })
                                    }
                                    className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-default ${
                                      on ? 'border-primary-600 bg-primary-600 text-white' : 'border-gray-300 bg-white text-gray-700 hover:border-primary-400'
                                    } ${byTruck ? 'opacity-80' : ''}`}
                                  >
                                    {w.name}
                                    {byTruck ? ' · por camión' : ''}
                                    {!w.active ? ' (inactivo)' : ''}
                                  </button>
                                )
                              })}
                            </div>
                          </div>

                          {everyone.length > 0 && (
                            <div>
                              <p className="mb-1 text-xs font-bold uppercase tracking-wide text-gray-500">Avisar por WhatsApp</p>
                              <div className="flex flex-wrap gap-2">
                                {everyone.map((w) => {
                                  const link = buildWhatsAppLink(
                                    w.phone,
                                    `Hola ${w.name.split(' ')[0]}, tienes un trabajo el ${fmtDate(job.date)} a las ${fmtTime(job.time)}: ${route || 'dirección por confirmar'}. El detalle está en ${siteUrl()}/trabajos`
                                  )
                                  return link ? (
                                    <a
                                      key={w.id}
                                      href={link}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="rounded-md border border-green-600 px-2.5 py-1 text-xs font-semibold text-green-700 hover:bg-green-50"
                                    >
                                      {w.name}
                                    </a>
                                  ) : (
                                    <span key={w.id} className="rounded-md border border-gray-200 px-2.5 py-1 text-xs text-gray-400" title="Sin teléfono válido en su ficha">
                                      {w.name} · sin teléfono
                                    </span>
                                  )
                                })}
                              </div>
                            </div>
                          )}

                          {onOpenBooking && job.quoteId && (
                            <Button size="sm" variant="outline" onClick={() => onOpenBooking(job.quoteId!)}>
                              Ver la reserva
                            </Button>
                          )}
                        </div>
                      )}
                    </li>
                  )
                })}
            </ul>
          </Card>
        ))
      )}
    </div>
  )
}
