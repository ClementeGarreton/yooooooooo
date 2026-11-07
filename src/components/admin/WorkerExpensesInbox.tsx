'use client'

import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import { EXPENSE_STATUS_LABEL, type WorkerExpense, type WorkerExpensesData } from '@/lib/workerExpenseTypes'

/**
 * Gastos de trabajadores por aprobar (dentro de «Por aprobar»). Cada gasto es un
 * comprobante con nombre y monto que el trabajador rindió desde su panel. Aprobar o
 * rechazar (con motivo) queda en Actividad y el trabajador ve el resultado en su panel.
 */

const clp = (n: number) => `$${Math.round(n).toLocaleString('es-CL')}`
const fmtDate = (d: string | null) => (d ? d.slice(0, 10).split('-').reverse().join('-') : '')
const when = (iso: string) =>
  new Date(iso).toLocaleString('es-CL', { timeZone: 'America/Santiago', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

const STATUS_STYLE = {
  pendiente: 'bg-amber-100 text-amber-800',
  aprobado: 'bg-green-100 text-green-800',
  rechazado: 'bg-red-100 text-red-700',
} as const

export default function WorkerExpensesInbox({
  onOpenBooking,
  onPendingCount,
}: {
  onOpenBooking?: (quoteId: string) => void
  onPendingCount?: (count: number) => void
}) {
  const [data, setData] = useState<WorkerExpensesData | null>(null)
  const [showAll, setShowAll] = useState(false)
  // Filtro por fecha en que se rindió (Tomás, 21-10-2026). Vacío = sin límite.
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  // Foto o documento que se está pasando a gasto.
  const [convert, setConvert] = useState<{ id: string; name: string; amount: string; payment: '' | 'contado' | 'credito'; docNumber: string } | null>(null)
  const [rejectingId, setRejectingId] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/expenses')
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || 'No se pudieron cargar los gastos')
      setData(body)
      onPendingCount?.(body.pending || 0)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudieron cargar los gastos')
    }
  }, [onPendingCount])

  useEffect(() => {
    load()
  }, [load])

  /** Forma de pago o reembolso de un gasto. */
  const update = async (expense: WorkerExpense, change: { payment?: 'contado' | 'credito'; reimbursed?: boolean }, ok: string) => {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/expenses/${expense.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(change),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || 'No se pudo guardar')
      toast.success(ok)
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo guardar')
    } finally {
      setBusy(false)
    }
  }

  const decide = async (expense: WorkerExpense, decision: 'aprobado' | 'rechazado') => {
    if (busy) return
    if (decision === 'rechazado' && !reason.trim()) {
      toast.error('Escribe el motivo del rechazo')
      return
    }
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/expenses/${expense.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, reason: decision === 'rechazado' ? reason : null }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || 'No se pudo guardar')
      toast.success(decision === 'aprobado' ? 'Gasto aprobado' : 'Gasto rechazado')
      setRejectingId(null)
      setReason('')
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo guardar')
    } finally {
      setBusy(false)
    }
  }

  const convertNow = async () => {
    if (!convert || busy) return
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/expenses/${convert.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: convert.name, amount: Number(convert.amount), payment: convert.payment, docNumber: convert.docNumber }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || 'No se pudo registrar')
      toast.success('Registrado como gasto: queda por aprobar')
      setConvert(null)
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo registrar')
    } finally {
      setBusy(false)
    }
  }

  if (!data) return null
  // Primero lo pendiente; lo ya revisado, al final.
  const chileDay = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date(iso))
  const inRange = (e: { createdAt: string }) => {
    const d = chileDay(e.createdAt)
    return (!from || d >= from) && (!to || d <= to)
  }
  const ranged = data.expenses.filter(inRange)
  const shown = showAll
    ? [...ranged.filter((e) => e.status === 'pendiente'), ...ranged.filter((e) => e.status !== 'pendiente')]
    : ranged.filter((e) => e.status === 'pendiente')
  const shownTotal = shown.reduce((sum, e) => sum + (e.amount || 0), 0)

  return (
    <Card className="mt-6 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold text-gray-900">Gastos de trabajadores</h3>
          <p className="text-sm text-gray-600">
            {data.pending === 0
              ? 'No hay gastos esperando aprobación.'
              : `${data.pending} por aprobar · ${clp(data.pendingTotal)}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label className="text-gray-600">
            Desde <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded border border-gray-300 px-2 py-1" />
          </label>
          <label className="text-gray-600">
            Hasta <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded border border-gray-300 px-2 py-1" />
          </label>
          {(from || to) && (
            <button type="button" onClick={() => { setFrom(''); setTo('') }} className="text-gray-500 hover:underline">
              Quitar fechas
            </button>
          )}
          <button type="button" onClick={() => setShowAll((v) => !v)} className="font-semibold text-primary-600 hover:underline">
            {showAll ? 'Ver solo los pendientes' : `Ver todos (${ranged.length})`}
          </button>
        </div>
      </div>
      {(from || to) && (
        <p className="mt-2 text-xs text-gray-500">
          {shown.length} gasto{shown.length === 1 ? '' : 's'} en estas fechas · {clp(shownTotal)}
        </p>
      )}

      {shown.length > 0 && (
        <ul className="mt-3 divide-y divide-gray-100">
          {shown.map((e) => (
            <li key={e.id} className="py-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-900">
                    {e.name} · {clp(e.amount)}
                    {e.docNumber && <span className="ml-2 text-xs font-medium text-gray-500">N° {e.docNumber}</span>}
                    <span
                      className={`ml-2 rounded-full px-2 py-0.5 text-xs font-medium ${
                        e.payment === 'credito'
                          ? 'bg-gray-100 text-gray-700'
                          : e.reimbursed
                            ? 'bg-green-100 text-green-800'
                            : 'bg-orange-100 text-orange-800'
                      }`}
                    >
                      {e.payment === 'credito' ? 'Crédito · pagó la empresa' : e.reimbursed ? 'Contado · reembolsado' : 'Contado · por reembolsar'}
                    </span>
                    {e.duplicateNumber && (
                      <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">N° repetido</span>
                    )}
                    <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[e.status]}`}>
                      {EXPENSE_STATUS_LABEL[e.status]}
                    </span>
                  </p>
                  <p className="text-xs text-gray-500">
                    {e.workerLabel} · {when(e.createdAt)}
                    {e.booking ? (
                      <>
                        {' · '}
                        {onOpenBooking && e.booking.quoteId ? (
                          <button type="button" onClick={() => onOpenBooking(e.booking!.quoteId!)} className="font-semibold text-primary-600 hover:underline">
                            {e.booking.code || 'Reserva'}
                          </button>
                        ) : (
                          e.booking.code || 'Reserva'
                        )}
                        {` · ${e.booking.clientName} · ${fmtDate(e.booking.date)}`}
                      </>
                    ) : (
                      ' · Sin trabajo asociado'
                    )}
                  </p>
                  {e.status !== 'pendiente' && (
                    <p className="text-xs text-gray-500">
                      {EXPENSE_STATUS_LABEL[e.status]} por {e.reviewedBy || '—'}
                      {e.reviewedAt ? ` · ${when(e.reviewedAt)}` : ''}
                      {e.rejectReason ? ` · Motivo: ${e.rejectReason}` : ''}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <a
                    href={`/api/admin/documents/${e.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-md border border-gray-300 px-2.5 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                  >
                    Ver comprobante
                  </a>
                  {e.status !== 'rechazado' && !e.reimbursedByClosing && (
                    <>
                      <select
                        value={e.payment}
                        disabled={busy}
                        onChange={(ev) => update(e, { payment: ev.target.value as 'contado' | 'credito' }, 'Forma de pago guardada')}
                        className="rounded-md border border-gray-300 px-2 py-1.5 text-xs font-semibold text-gray-700"
                        aria-label="Forma de pago"
                      >
                        <option value="contado">Contado</option>
                        <option value="credito">Crédito</option>
                      </select>
                      {e.payment === 'contado' && e.status === 'aprobado' && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => update(e, { reimbursed: !e.reimbursed }, e.reimbursed ? 'Quedó por reembolsar' : 'Marcado como reembolsado')}
                          className="rounded-md border border-gray-300 px-2.5 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                        >
                          {e.reimbursed ? 'Desmarcar reembolso' : 'Marcar reembolsado'}
                        </button>
                      )}
                    </>
                  )}
                  {e.status === 'pendiente' && rejectingId !== e.id && (
                    <>
                      <Button size="sm" disabled={busy} onClick={() => decide(e, 'aprobado')}>
                        Aprobar
                      </Button>
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => { setRejectingId(e.id); setReason('') }}>
                        Rechazar
                      </Button>
                    </>
                  )}
                </div>
              </div>
              {rejectingId === e.id && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <input
                    autoFocus
                    value={reason}
                    onChange={(ev) => setReason(ev.target.value)}
                    maxLength={500}
                    placeholder="Motivo del rechazo (lo lee el trabajador)"
                    className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
                  />
                  <Button size="sm" disabled={busy} onClick={() => decide(e, 'rechazado')}>
                    Confirmar rechazo
                  </Button>
                  <button type="button" onClick={() => setRejectingId(null)} className="text-sm text-gray-500">
                    Cancelar
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {(data.loose || []).length > 0 && (
        <div className="mt-5 border-t border-gray-100 pt-4">
          <h4 className="text-sm font-bold text-gray-900">Fotos y documentos subidos sin monto ({data.loose.length})</h4>
          <p className="text-xs text-gray-500">
            Archivos que un trabajador subió a un trabajo como foto o documento, no como gasto: por eso no traen monto ni aparecen arriba. Si alguno es un
            comprobante, «Registrar como gasto» le pone nombre y monto y lo deja por aprobar. Los últimos 120 días.
          </p>
          <ul className="mt-2 divide-y divide-gray-100">
            {data.loose.map((u) => (
              <li key={u.id} className="py-2.5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900">{u.note || u.fileName || 'Sin nota'}</p>
                    <p className="text-xs text-gray-500">
                      {[u.kind === 'foto' ? 'Foto' : 'Documento', u.workerLabel, when(u.createdAt), u.booking ? [u.booking.code, u.booking.clientName].filter(Boolean).join(' · ') : null]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <a
                      href={`/api/admin/documents/${u.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-md border border-gray-300 px-2.5 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                    >
                      Ver archivo
                    </a>
                    {convert?.id !== u.id && (
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => setConvert({ id: u.id, name: (u.note || '').slice(0, 120), amount: '', payment: '', docNumber: '' })}>
                        Registrar como gasto
                      </Button>
                    )}
                  </div>
                </div>
                {convert?.id === u.id && (
                  <div className="mt-2 flex flex-wrap items-end gap-2 rounded-lg bg-gray-50 p-3">
                    <div className="min-w-0 flex-1 basis-48">
                      <label className="mb-1 block text-xs font-medium text-gray-600">Nombre del gasto</label>
                      <input value={convert.name} maxLength={120} onChange={(e) => setConvert({ ...convert, name: e.target.value })} className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-gray-600">Monto</label>
                      <input
                        autoFocus
                        inputMode="numeric"
                        value={convert.amount}
                        onChange={(e) => setConvert({ ...convert, amount: e.target.value.replace(/\D/g, '') })}
                        className="w-28 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-gray-600">Cómo se pagó</label>
                      <select
                        value={convert.payment}
                        onChange={(e) => setConvert({ ...convert, payment: e.target.value as '' | 'contado' | 'credito' })}
                        className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                      >
                        <option value="">Elegir</option>
                        <option value="contado">Contado (lo pagó el trabajador)</option>
                        <option value="credito">Crédito (lo pagó la empresa)</option>
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-gray-600">N° boleta (opcional)</label>
                      <input value={convert.docNumber} maxLength={40} onChange={(e) => setConvert({ ...convert, docNumber: e.target.value })} className="w-32 rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
                    </div>
                    <Button size="sm" disabled={busy || convert.name.trim().length < 2 || !(Number(convert.amount) > 0) || !convert.payment} onClick={convertNow}>
                      Guardar gasto
                    </Button>
                    <button type="button" onClick={() => setConvert(null)} className="pb-1.5 text-sm text-gray-500">
                      Cancelar
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  )
}
