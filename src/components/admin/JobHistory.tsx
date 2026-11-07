'use client'

import { Fragment, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import PeriodFilter from './PeriodFilter'
import { periodOf, resolvePeriod, type Period } from '@/lib/period'
import type { JobHistoryData } from '@/lib/jobHistoryTypes'

/**
 * Trabajos → Historial: todos los trabajos ya realizados, con su ID, para buscar por nombre
 * del cliente, dirección, camión o trabajador. Solo lectura; el ID abre la reserva.
 */

const fmtDate = (d: string) => d.split('-').reverse().join('-')
const WORK_LABEL = { sin_iniciar: 'Sin marca', en_curso: 'En curso', finalizado: 'Finalizado' } as const
const WORK_CLASS = { sin_iniciar: 'bg-gray-100 text-gray-600', en_curso: 'bg-blue-100 text-blue-800', finalizado: 'bg-green-100 text-green-800' } as const
const selectClass = 'rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm'
const fmtStamp = (iso: string) =>
  new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))

interface JobDetailData {
  bookingNotes: string | null
  teamNotes: { id: string; note: string; by: string | null; at: string }[]
  documents: { id: string; kind: string; file_name: string | null; mime_type: string | null; note: string | null; uploaded_by_label: string | null; created_at: string }[]
}

/** Notas del equipo, notas de la reserva y fotos de un trabajo del historial. */
function JobDetail({ detail }: { detail: JobDetailData | 'loading' | 'error' | undefined }) {
  if (!detail || detail === 'loading') return <p className="text-sm text-gray-500">Cargando…</p>
  if (detail === 'error') return <p className="text-sm text-red-700">No se pudo cargar.</p>
  const photos = detail.documents.filter((d) => (d.mime_type || '').startsWith('image/'))
  const files = detail.documents.filter((d) => !(d.mime_type || '').startsWith('image/'))
  return (
    <div className="grid gap-4 text-sm lg:grid-cols-2">
      <div className="space-y-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Comentarios del equipo</p>
          {detail.teamNotes.length === 0 ? (
            <p className="text-gray-500">Sin comentarios.</p>
          ) : (
            <ul className="mt-1 space-y-1">
              {detail.teamNotes.map((n) => (
                <li key={n.id} className="rounded-lg bg-white px-3 py-2">
                  <p className="whitespace-pre-line text-gray-900">{n.note}</p>
                  <p className="text-xs text-gray-500">{[n.by, fmtStamp(n.at)].filter(Boolean).join(' · ')}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
        {detail.bookingNotes && (
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Notas de la reserva</p>
            <p className="mt-1 whitespace-pre-line rounded-lg bg-white px-3 py-2 text-gray-800">{detail.bookingNotes}</p>
          </div>
        )}
      </div>
      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Fotos y documentos ({detail.documents.length})</p>
        {detail.documents.length === 0 ? (
          <p className="text-gray-500">Nadie subió archivos.</p>
        ) : (
          <>
            <div className="mt-1 flex flex-wrap gap-2">
              {photos.map((d) => (
                <a key={d.id} href={`/api/admin/documents/${d.id}`} target="_blank" rel="noreferrer" title={[d.note, d.uploaded_by_label, fmtStamp(d.created_at)].filter(Boolean).join(' · ')}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/admin/documents/${d.id}`} alt={d.note || d.file_name || 'Foto'} loading="lazy" className="h-24 w-24 rounded-lg border border-gray-200 object-cover" />
                </a>
              ))}
            </div>
            {files.length > 0 && (
              <ul className="mt-2 space-y-1">
                {files.map((d) => (
                  <li key={d.id}>
                    <a href={`/api/admin/documents/${d.id}`} target="_blank" rel="noreferrer" className="text-primary-600 underline">
                      {d.file_name || d.note || 'Documento'}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default function JobHistory({ onOpenBooking }: { onOpenBooking?: (quoteId: string) => void }) {
  const [period, setPeriod] = useState<Period>(periodOf('all'))
  const range = resolvePeriod(period)
  const [text, setText] = useState('')
  const [q, setQ] = useState('')
  const [vehicle, setVehicle] = useState('')
  const [worker, setWorker] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<JobHistoryData | null>(null)
  const [loading, setLoading] = useState(true)
  const [openId, setOpenId] = useState<string | null>(null)
  const [details, setDetails] = useState<Record<string, JobDetailData | 'loading' | 'error'>>({})

  const toggleDetail = async (id: string) => {
    if (openId === id) return setOpenId(null)
    setOpenId(id)
    if (details[id] && details[id] !== 'error') return
    setDetails((d) => ({ ...d, [id]: 'loading' }))
    try {
      const res = await fetch(`/api/admin/jobs/history/${id}`)
      const body = await res.json()
      if (!res.ok) throw new Error()
      setDetails((d) => ({ ...d, [id]: body }))
    } catch {
      setDetails((d) => ({ ...d, [id]: 'error' }))
    }
  }

  // La búsqueda por texto espera a que se deje de escribir.
  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(text.trim())
      setPage(1)
    }, 350)
    return () => clearTimeout(timer)
  }, [text])

  useEffect(() => {
    let alive = true
    setLoading(true)
    const params = new URLSearchParams({ pagina: String(page) })
    if (q) params.set('q', q)
    if (vehicle) params.set('camion', vehicle)
    if (worker) params.set('trabajador', worker)
    if (range.from) params.set('desde', range.from)
    if (range.to) params.set('hasta', range.to)
    fetch(`/api/admin/jobs/history?${params}`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(body?.error || 'No se pudo cargar el historial')
        if (alive) setData(body)
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : 'No se pudo cargar el historial'))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [q, vehicle, worker, range.from, range.to, page])

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1
  const filtered = Boolean(q || vehicle || worker || range.from || range.to)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-gray-600">Trabajos realizados, del más reciente al más antiguo. Sin los cancelados ni los no atendidos.</p>
        <PeriodFilter
          value={period}
          onChange={(next) => {
            setPeriod(next)
            setPage(1)
          }}
          presets={['all', 'week', 'month', 'custom']}
        />
      </div>

      <Card className="flex flex-wrap items-end gap-3 p-4">
        <div className="min-w-0 flex-1 basis-64">
          <label className="mb-1 block text-xs font-medium text-gray-600">Buscar</label>
          <input
            type="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="ID (RES-000123), nombre, teléfono o dirección"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Camión</label>
          <select
            value={vehicle}
            onChange={(e) => {
              setVehicle(e.target.value)
              setPage(1)
            }}
            className={selectClass}
          >
            <option value="">Todos</option>
            {(data?.vehicles || []).map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Trabajador</label>
          <select
            value={worker}
            onChange={(e) => {
              setWorker(e.target.value)
              setPage(1)
            }}
            className={selectClass}
          >
            <option value="">Todos</option>
            {(data?.workers || []).map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </div>
        {filtered && (
          <button
            type="button"
            onClick={() => {
              setText('')
              setVehicle('')
              setWorker('')
              setPeriod(periodOf('all'))
              setPage(1)
            }}
            className="pb-2 text-sm font-semibold text-primary-600 hover:underline"
          >
            Limpiar filtros
          </button>
        )}
      </Card>

      {!data ? (
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary-600" />
        </div>
      ) : (
        <Card className={`overflow-hidden p-0 ${loading ? 'opacity-60' : ''}`}>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-4 py-2.5 text-sm text-gray-600">
            <span>
              {data.total} trabajo{data.total === 1 ? '' : 's'}
              {filtered ? ' con estos filtros' : ' en total'}
            </span>
            {pages > 1 && (
              <span className="flex items-center gap-2">
                <Button size="sm" variant="outline" disabled={page <= 1 || loading} onClick={() => setPage(page - 1)}>
                  Anterior
                </Button>
                Página {page} de {pages}
                <Button size="sm" variant="outline" disabled={page >= pages || loading} onClick={() => setPage(page + 1)}>
                  Siguiente
                </Button>
              </span>
            )}
          </div>
          {data.rows.length === 0 ? (
            <p className="p-5 text-sm text-gray-500">Ningún trabajo coincide con la búsqueda.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-500">
                    <th className="px-4 py-2 font-semibold">ID</th>
                    <th className="px-3 py-2 font-semibold">Fecha</th>
                    <th className="px-3 py-2 font-semibold">Cliente</th>
                    <th className="px-3 py-2 font-semibold">Recorrido</th>
                    <th className="px-3 py-2 font-semibold">Camión</th>
                    <th className="px-3 py-2 font-semibold">Equipo</th>
                    <th className="px-4 py-2 font-semibold">Marca</th>
                    <th className="px-3 py-2 font-semibold" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-gray-700">
                  {data.rows.map((r) => (
                    <Fragment key={r.id}>
                    <tr className="align-top">
                      <td className="whitespace-nowrap px-4 py-2 font-semibold">
                        {onOpenBooking && r.quoteId ? (
                          <button type="button" onClick={() => onOpenBooking(r.quoteId!)} className="text-primary-600 hover:underline">
                            {r.code || 'Abrir'}
                          </button>
                        ) : (
                          <span className="text-gray-900">{r.code || '—'}</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">
                        {fmtDate(r.date)}
                        <span className="block text-xs text-gray-500">{r.time ? r.time.slice(0, 5) : 'Sin hora'}</span>
                      </td>
                      <td className="px-3 py-2 text-gray-900">
                        {r.clientName || 'Sin nombre'}
                        {r.clientPhone && <span className="block text-xs text-gray-500">{r.clientPhone}</span>}
                      </td>
                      <td className="max-w-xs px-3 py-2 text-xs">
                        {r.origin || 'Sin dirección'}
                        {r.destination && <span className="block text-gray-500">→ {r.destination}</span>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">{r.vehicleName || <span className="text-amber-700">Sin camión</span>}</td>
                      <td className="px-3 py-2 text-xs">{r.workers.length > 0 ? r.workers.join(', ') : <span className="text-amber-700">Nadie asignado</span>}</td>
                      <td className="whitespace-nowrap px-4 py-2">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${WORK_CLASS[r.work]}`}>{WORK_LABEL[r.work]}</span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">
                        <button type="button" onClick={() => toggleDetail(r.id)} className="text-xs font-semibold text-primary-600 hover:underline">
                          {openId === r.id ? 'Ocultar' : 'Notas y fotos'}
                        </button>
                      </td>
                    </tr>
                    {openId === r.id && (
                      <tr>
                        <td colSpan={8} className="bg-gray-50 px-4 py-3">
                          <JobDetail detail={details[r.id]} />
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
      <p className="text-xs text-gray-500">
        «Marca» es lo que registró el equipo desde su panel al iniciar y finalizar; los trabajos anteriores a octubre de 2026 no la tienen. El filtro por
        trabajador incluye los trabajos de su cuadrilla y los de su camión habitual.
      </p>
    </div>
  )
}
