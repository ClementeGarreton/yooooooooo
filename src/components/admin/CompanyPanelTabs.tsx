'use client'

import { useMemo, useState } from 'react'
import Button from '@/components/ui/Button'
import DocumentList from '@/components/documents/DocumentList'
import type { CompanyBooking, CompanyMember } from '@/lib/companies'
import type { CompanyJob, CompanyNote, CompanyPanelData } from '@/lib/companyPanel'
import type { StoredDocument } from '@/lib/documents'
import { INVOICE_STATUS_LABEL } from '@/lib/invoiceTypes'

/**
 * Pestañas del panel de una empresa (Francisco, 27-10-2026): Resumen, Trabajos (con quién
 * los hizo), Facturas, Documentos y Notas. Cierres y Personas y datos usan los componentes
 * que ya existían (CompanyClosingPanel, y la ficha en CompaniesManagement).
 */

export type CompanyTab = 'resumen' | 'trabajos' | 'cierres' | 'facturas' | 'documentos' | 'notas' | 'datos'

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pendiente',
  confirmed: 'Confirmado',
  completed: 'Completado',
  cancelled: 'Cancelado',
  no_show: 'No atendido',
}
const INACTIVE = ['cancelled', 'no_show']

const clp = (n: number | null) => `$${Math.round(n || 0).toLocaleString('es-CL')}`
const fmtDate = (d: string | null) => {
  if (!d) return 'Sin fecha'
  const [y, m, day] = d.slice(0, 10).split('-')
  return `${day}-${m}-${y}`
}
const fmtDateTime = (iso: string) =>
  new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso))
const todayChile = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date())
const prevMonth = (ym: string) => {
  const [y, m] = ym.split('-').map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}
const bookingHref = (code: string) => `/admin?tab=bookings&q=${encodeURIComponent(code)}`

/** Trabajos hasta hoy que no están en ningún cierre guardado vigente. */
function pendingClosing(jobs: CompanyJob[], closings: CompanyPanelData['closings']): CompanyJob[] {
  const today = todayChile()
  return jobs.filter(
    (j) => j.date && j.date <= today && !INACTIVE.includes(j.status || '') && !closings.some((c) => c.from <= j.date! && c.to >= j.date!)
  )
}

function Stat({ label, value, hint, onClick }: { label: string; value: string | number; hint?: string; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className="rounded-lg border border-gray-200 p-3 text-left enabled:hover:border-primary-300 enabled:hover:bg-primary-50/40"
    >
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-gray-900 tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-gray-500">{hint}</p>}
    </button>
  )
}

export function CompanySummaryTab({
  panel,
  members,
  legacyNote,
  onGo,
}: {
  panel: CompanyPanelData
  members: CompanyMember[]
  legacyNote: string | null
  onGo: (tab: CompanyTab) => void
}) {
  const month = todayChile().slice(0, 7)
  const active = panel.jobs.filter((j) => !INACTIVE.includes(j.status || ''))
  const thisMonth = active.filter((j) => j.date?.startsWith(month)).length
  const lastMonth = active.filter((j) => j.date?.startsWith(prevMonth(month))).length
  // Las que se cierran por unidad (Monfiza) se cobran con el cierre; el resto, con la factura.
  const pending = panel.closesByUnit
    ? pendingClosing(panel.jobs, panel.closings)
    : panel.jobs.filter((j) => j.date && j.date <= todayChile() && !INACTIVE.includes(j.status || '') && !j.invoiced)
  const noCrew = pending.filter((j) => j.workers.length === 0).length
  const emitted = panel.invoices.filter((i) => i.status === 'emitida')
  const lastClosing = panel.closings[0]
  const managers = members.filter((m) => m.role === 'encargado')

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Trabajos este mes" value={thisMonth} hint={`Mes anterior: ${lastMonth}`} onClick={() => onGo('trabajos')} />
        <Stat
          label={panel.closesByUnit ? 'Sin cerrar (hasta hoy)' : 'Sin facturar (hasta hoy)'}
          value={pending.length}
          hint={pending.length > 0 ? `Desde el ${fmtDate(pending[pending.length - 1].date)}` : panel.closesByUnit ? 'Todo cerrado' : 'Todo facturado'}
          onClick={() => onGo(panel.closesByUnit ? 'cierres' : 'facturas')}
        />
        <Stat
          label="Sin trabajador asignado"
          value={noCrew}
          hint={panel.closesByUnit ? 'De los que faltan por cerrar' : 'De los que faltan por facturar'}
          onClick={() => onGo('trabajos')}
        />
        <Stat label="Facturas emitidas" value={emitted.length} hint={emitted[0] ? `Última: folio ${emitted[0].folio || '—'}` : 'Ninguna'} onClick={() => onGo('facturas')} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-gray-200 p-3 text-sm">
          <p className="mb-1 text-xs font-bold uppercase tracking-wide text-gray-500">Último cierre</p>
          {lastClosing ? (
            <p>
              Del {fmtDate(lastClosing.from)} al {fmtDate(lastClosing.to)}
              {lastClosing.totalClp > 0 ? ` · ${clp(lastClosing.totalClp)} neto (referencial)` : ''}
              <span className="block text-xs text-gray-500">{[lastClosing.closedBy, fmtDate(lastClosing.closedAt)].filter(Boolean).join(', ')}</span>
            </p>
          ) : (
            <p className="text-gray-500">Todavía no hay cierres guardados.</p>
          )}
          <Button size="sm" variant="outline" className="mt-2" onClick={() => onGo('cierres')}>
            Ir a cierres y PDF
          </Button>
        </div>
        <div className="rounded-lg border border-gray-200 p-3 text-sm">
          <p className="mb-1 text-xs font-bold uppercase tracking-wide text-gray-500">Encargado{managers.length === 1 ? '' : 's'}</p>
          {managers.length === 0 ? (
            <p className="text-gray-500">Nadie con rol de encargado.</p>
          ) : (
            <ul className="space-y-0.5">
              {managers.map((m) => (
                <li key={m.id}>
                  {m.name || m.email}
                  <span className="text-xs text-gray-500"> · {[m.email, m.phone].filter(Boolean).join(' · ')}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-gray-200 p-3 text-sm">
        <div className="mb-1 flex items-center justify-between">
          <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Últimas notas</p>
          <button type="button" onClick={() => onGo('notas')} className="text-xs text-primary-600 hover:underline">
            Ver todas o agregar
          </button>
        </div>
        {panel.notes.length === 0 && !legacyNote ? (
          <p className="text-gray-500">Sin notas.</p>
        ) : (
          <NoteList notes={panel.notes.slice(0, 3)} legacyNote={panel.notes.length === 0 ? legacyNote : null} />
        )}
      </div>
    </div>
  )
}

export function CompanyJobsTab({
  jobs,
  candidates,
  busy,
  onRemove,
  onAssign,
  onShowFiles,
}: {
  jobs: CompanyJob[]
  candidates: CompanyBooking[]
  busy: boolean
  onRemove: (job: CompanyJob) => void
  onAssign: (ids: string[], confirmText?: string) => void
  onShowFiles: (bookingId: string) => void
}) {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [status, setStatus] = useState('')
  const [worker, setWorker] = useState('')
  const [search, setSearch] = useState('')

  // Todo menos el trabajador: así los conteos por trabajador responden a las fechas y el estado.
  const base = useMemo(() => {
    const q = search.trim().toLowerCase()
    return jobs.filter(
      (j) =>
        (!from || (j.date && j.date >= from)) &&
        (!to || (j.date && j.date <= to)) &&
        (!status || j.status === status) &&
        (!q || [j.code, j.clientName, j.customer].some((v) => String(v || '').toLowerCase().includes(q)))
    )
  }, [jobs, from, to, status, search])

  const byWorker = useMemo(() => {
    const counts = new Map<string, { name: string; count: number }>()
    let none = 0
    for (const j of base) {
      if (j.workers.length === 0) none++
      for (const w of j.workers) counts.set(w.id, { name: w.name, count: (counts.get(w.id)?.count || 0) + 1 })
    }
    return { list: Array.from(counts, ([id, v]) => ({ id, ...v })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)), none }
  }, [base])

  const shown = base.filter((j) => !worker || (worker === 'none' ? j.workers.length === 0 : j.workers.some((w) => w.id === worker)))
  const select = 'rounded-lg border border-gray-300 px-2 py-1.5 text-sm'
  const chip = (active: boolean) =>
    `rounded-full border px-2.5 py-1 text-xs ${active ? 'border-primary-500 bg-primary-50 font-semibold text-primary-700' : 'border-gray-300 text-gray-700 hover:bg-gray-50'}`

  return (
    <div className="space-y-4">
      {candidates.length > 0 && (
        <div className="rounded-lg bg-amber-50 p-3">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-amber-900">Reservas de sus personas sin asignar a la empresa ({candidates.length})</p>
            <div className="flex flex-wrap gap-2">
              {candidates.some((b) => b.rutMatches) && (
                <Button size="sm" variant="outline" disabled={busy} onClick={() => onAssign(candidates.filter((b) => b.rutMatches).map((b) => b.id))}>
                  Asignar las reservadas con este RUT
                </Button>
              )}
              <Button
                size="sm"
                disabled={busy}
                onClick={() => onAssign(candidates.map((b) => b.id), `¿Asignar las ${candidates.length} reservas a la empresa? Se le van a facturar.`)}
              >
                Asignar todas ({candidates.length})
              </Button>
            </div>
          </div>
          <p className="mb-1 text-xs text-amber-800">Pueden ser mudanzas personales: asigna solo las que correspondan a la empresa.</p>
          <ul className="divide-y divide-amber-200">
            {candidates.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-sm">
                <span>
                  {b.code || 'Sin código'} · {fmtDate(b.scheduledDate)} · {b.clientName || 'Sin nombre'}
                  {b.rutMatches && <span className="ml-2 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">Con este RUT</span>}
                </span>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => onAssign([b.id])}>
                  Asignar
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Desde</label>
          <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className={select} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Hasta</label>
          <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className={select} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Estado</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={select}>
            <option value="">Todos</option>
            {Object.entries(STATUS_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-[12rem] flex-1">
          <label className="mb-1 block text-xs font-medium text-gray-600">Buscar</label>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Código, solicitante o cliente final" className={`${select} w-full`} />
        </div>
        {(from || to || status || search || worker) && (
          <button
            type="button"
            onClick={() => {
              setFrom('')
              setTo('')
              setStatus('')
              setSearch('')
              setWorker('')
            }}
            className="pb-2 text-xs text-primary-600 hover:underline"
          >
            Limpiar filtros
          </button>
        )}
      </div>

      <div>
        <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-gray-500">Por trabajador</p>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" className={chip(worker === '')} onClick={() => setWorker('')}>
            Todos ({base.length})
          </button>
          {byWorker.list.map((w) => (
            <button key={w.id} type="button" className={chip(worker === w.id)} onClick={() => setWorker(worker === w.id ? '' : w.id)}>
              {w.name} ({w.count})
            </button>
          ))}
          {byWorker.none > 0 && (
            <button type="button" className={chip(worker === 'none')} onClick={() => setWorker(worker === 'none' ? '' : 'none')}>
              Sin trabajador ({byWorker.none})
            </button>
          )}
        </div>
        <p className="mt-1 text-xs text-gray-500">Un trabajo con dos personas cuenta para cada una.</p>
      </div>

      {shown.length === 0 ? (
        <p className="text-sm text-gray-500">{jobs.length === 0 ? 'La empresa todavía no tiene reservas asignadas.' : 'Ningún trabajo con esos filtros.'}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full min-w-[920px] text-sm">
            <thead className="bg-gray-50 text-left text-xs text-gray-500">
              <tr>
                <th className="px-3 py-2 font-medium">Fecha</th>
                <th className="px-3 py-2 font-medium">Reserva</th>
                <th className="px-3 py-2 font-medium">Cliente final / solicitante</th>
                <th className="px-3 py-2 font-medium">Trabajadores</th>
                <th className="px-3 py-2 font-medium">Estado</th>
                <th className="px-3 py-2 font-medium">Archivos</th>
                <th className="px-3 py-2 text-right font-medium">Monto</th>
                <th className="px-3 py-2 font-medium">Facturada</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {shown.map((j) => (
                <tr key={j.id} className={INACTIVE.includes(j.status || '') ? 'text-gray-400' : ''}>
                  <td className="whitespace-nowrap px-3 py-2">{fmtDate(j.date)}</td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {j.code ? (
                      <a href={bookingHref(j.code)} target="_blank" rel="noreferrer" className="font-medium text-primary-600 hover:underline">
                        {j.code}
                      </a>
                    ) : (
                      'Sin código'
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {j.customer || '—'}
                    {j.clientName && <span className="block text-xs text-gray-500">{j.clientName}</span>}
                  </td>
                  <td className="px-3 py-2">{j.workers.length ? j.workers.map((w) => w.name).join(', ') : <span className="text-amber-700">Sin asignar</span>}</td>
                  <td className="whitespace-nowrap px-3 py-2">{STATUS_LABEL[j.status || ''] || j.status || '—'}</td>
                  <td className="px-3 py-2">
                    {j.files > 0 ? (
                      <button type="button" onClick={() => onShowFiles(j.id)} className="text-primary-600 hover:underline">
                        {j.files} {j.files === 1 ? 'archivo' : 'archivos'}
                      </button>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                    {j.priceUf !== null ? `${j.priceUf.toLocaleString('es-CL', { maximumFractionDigits: 4 })} UF` : j.price > 0 ? clp(j.price) : '—'}
                  </td>
                  <td className="px-3 py-2">{j.invoiced ? 'Sí' : <span className="text-gray-400">No</span>}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onRemove(j)}
                      className="text-xs text-gray-500 hover:text-red-600 hover:underline"
                      title="Deja de facturarse a la empresa"
                    >
                      quitar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-gray-500">
        {shown.length} de {jobs.length} reservas. Click en el código para abrirla en Reservas (pestaña nueva). «quitar» la saca de la empresa: deja de
        facturársele.
      </p>
    </div>
  )
}

export function CompanyInvoicesTab({ invoices }: { invoices: CompanyPanelData['invoices'] }) {
  if (invoices.length === 0) return <p className="text-sm text-gray-500">Todavía no hay facturas de esta empresa.</p>
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200">
      <table className="w-full min-w-[720px] text-sm">
        <thead className="bg-gray-50 text-left text-xs text-gray-500">
          <tr>
            <th className="px-3 py-2 font-medium">Mes</th>
            <th className="px-3 py-2 font-medium">Folio</th>
            <th className="px-3 py-2 font-medium">Emisión</th>
            <th className="px-3 py-2 text-right font-medium">Neto</th>
            <th className="px-3 py-2 text-right font-medium">IVA</th>
            <th className="px-3 py-2 text-right font-medium">Total</th>
            <th className="px-3 py-2 font-medium">Estado</th>
            <th className="px-3 py-2 font-medium">PDF</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {invoices.map((i) => (
            <tr key={i.id}>
              <td className="whitespace-nowrap px-3 py-2">{i.period.split('-').reverse().join('-')}</td>
              <td className="px-3 py-2">{i.folio || '—'}</td>
              <td className="whitespace-nowrap px-3 py-2">{i.fechaEmision ? fmtDate(i.fechaEmision) : '—'}</td>
              <td className="px-3 py-2 text-right tabular-nums">{i.neto !== null ? clp(i.neto) : '—'}</td>
              <td className="px-3 py-2 text-right tabular-nums">{i.iva !== null ? clp(i.iva) : '—'}</td>
              <td className="px-3 py-2 text-right font-semibold tabular-nums">{i.total !== null ? clp(i.total) : '—'}</td>
              <td className="whitespace-nowrap px-3 py-2">{INVOICE_STATUS_LABEL[i.status] || i.status}</td>
              <td className="whitespace-nowrap px-3 py-2">
                {i.status === 'emitida' ? (
                  <>
                    <a href={`/api/admin/invoices/${i.id}/pdf`} target="_blank" rel="noreferrer" className="text-primary-600 hover:underline">
                      ver
                    </a>{' '}
                    <a href={`/api/admin/invoices/${i.id}/pdf?descargar=1`} className="ml-1 text-primary-600 hover:underline">
                      bajar
                    </a>
                  </>
                ) : (
                  '—'
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function CompanyDocumentsTab({
  documents,
  bookingFilter,
  onBookingFilter,
}: {
  documents: (StoredDocument & { context?: string | null })[]
  bookingFilter: string
  onBookingFilter: (bookingId: string) => void
}) {
  const options = useMemo(() => {
    const seen = new Map<string, string>()
    for (const d of documents) if (d.booking_id && !seen.has(d.booking_id)) seen.set(d.booking_id, d.context || 'Reserva')
    return Array.from(seen, ([id, label]) => ({ id, label })).sort((a, b) => b.label.localeCompare(a.label))
  }, [documents])
  const shown =
    bookingFilter === '' ? documents : bookingFilter === 'empresa' ? documents.filter((d) => !d.booking_id) : documents.filter((d) => d.booking_id === bookingFilter)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Mostrar</label>
          <select value={bookingFilter} onChange={(e) => onBookingFilter(e.target.value)} className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm">
            <option value="">Todos ({documents.length})</option>
            <option value="empresa">De la empresa, sin reserva</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <p className="pb-2 text-xs text-gray-500">Incluye lo que sube el equipo en terreno a cada reserva.</p>
      </div>
      <DocumentList
        documents={shown}
        hrefFor={(doc, download) => `/api/admin/documents/${doc.id}${download ? '?descargar=1' : ''}`}
        empty="No hay documentos con ese filtro."
      />
    </div>
  )
}

function NoteList({ notes, legacyNote }: { notes: CompanyNote[]; legacyNote: string | null }) {
  return (
    <ul className="space-y-2">
      {notes.map((n) => (
        <li key={n.id} className="rounded-lg bg-gray-50 px-3 py-2">
          <p className="text-xs text-gray-500">
            {fmtDateTime(n.createdAt)} · {n.authorName || n.author || 'Sin autor'}
          </p>
          <p className="whitespace-pre-wrap text-sm text-gray-900">{n.body}</p>
        </li>
      ))}
      {legacyNote && (
        <li className="rounded-lg border border-dashed border-gray-300 px-3 py-2">
          <p className="text-xs text-gray-500">Nota anterior (sin fecha ni autor)</p>
          <p className="whitespace-pre-wrap text-sm text-gray-900">{legacyNote}</p>
        </li>
      )}
    </ul>
  )
}

export function CompanyNotesTab({
  notes,
  available,
  legacyNote,
  busy,
  onAdd,
}: {
  notes: CompanyNote[]
  available: boolean
  legacyNote: string | null
  busy: boolean
  onAdd: (body: string) => Promise<boolean>
}) {
  const [draft, setDraft] = useState('')
  return (
    <div className="space-y-4">
      {!available ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Falta correr la migración <code>database/migrations/add_notas_empresa.sql</code> para guardar notas con fecha y autor.
        </p>
      ) : (
        <div className="space-y-2">
          <textarea
            value={draft}
            maxLength={2000}
            rows={3}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Ej.: Philip autorizó el doble cobro de la OD 40462."
            className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-gray-500">Queda con la fecha y tu nombre. Las notas no se editan ni se borran.</p>
            <Button
              size="sm"
              disabled={busy || !draft.trim()}
              onClick={async () => {
                if (await onAdd(draft)) setDraft('')
              }}
            >
              Agregar nota
            </Button>
          </div>
        </div>
      )}
      {notes.length === 0 && !legacyNote ? <p className="text-sm text-gray-500">Todavía no hay notas.</p> : <NoteList notes={notes} legacyNote={legacyNote} />}
    </div>
  )
}
