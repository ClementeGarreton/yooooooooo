'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import PeriodFilter from './PeriodFilter'
import { periodOf, resolvePeriod, type Period } from '@/lib/period'
import { buildPayStatement, type PayStatement, type WorkerPayData, type WorkerPayRow } from '@/lib/workerPayTypes'
import { downloadStatementsCsv, downloadStatementsPdf, type StatementToExport } from '@/lib/payStatementExport'

/**
 * Finanzas → Cierre de pagos. Para un período (semana, mes o las fechas que se elijan) y los
 * funcionarios que se marquen: el historial de trabajo de cada uno, sus gastos y ajustes, lo
 * que se le debe, y el cierre.
 *
 * Antes de cerrar se puede corregir: agregar una bonificación o un descuento con su motivo.
 * Cerrar guarda una copia del detalle con su glosa y deja pagados los gastos de contado que
 * entran; desde ahí ese período no se toca. Reabrirlo es solo del perfil Administrador.
 * El detalle se descarga en PDF (una página por funcionario, con la glosa) o en CSV, y el de
 * un período cerrado se le puede mandar por correo a cada funcionario.
 */

const clp = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(Math.round(n)).toLocaleString('es-CL')}`
// Una fecha AAAA-MM-DD se muestra tal cual; un instante (pago, cierre) en el día de Chile.
const day = (d: string) =>
  (d.length > 10 ? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date(d)) : d.slice(0, 10)).split('-').reverse().join('-')
const KIND_LABEL = { trabajo: 'Trabajo', gasto: 'Gasto', ajuste: 'Ajuste', base: 'Sueldo base' } as const

export default function PayClosingPanel() {
  const [period, setPeriod] = useState<Period>(periodOf('week'))
  const resolved = resolvePeriod(period)
  const week = resolvePeriod(periodOf('week'))
  const from = resolved.from && resolved.to ? resolved.from : (week.from as string)
  const to = resolved.from && resolved.to ? resolved.to : (week.to as string)

  const [data, setData] = useState<WorkerPayData | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [openId, setOpenId] = useState<string | null>(null)
  const [adjust, setAdjust] = useState<{ id: string; sign: 1 | -1; amount: string; date: string; note: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/worker-pay?desde=${from}&hasta=${to}`)
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || 'No se pudo cargar')
      setData(body)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo cargar')
    }
  }, [from, to])

  useEffect(() => {
    setData(null)
    setSelected(new Set())
    load()
  }, [load])

  // Solo quienes tienen algo en el período: trabajos, gastos, ajustes, pagos o un cierre.
  const rows = useMemo(
    () => (data?.rows || []).filter((r) => r.jobs.length > 0 || r.expenses.length > 0 || r.bonuses.length > 0 || r.baseMonths.length > 0 || r.paid > 0 || r.closing),
    [data]
  )

  /** El detalle que vale para una fila: la copia del cierre si está cerrada, si no el cálculo de ahora. */
  const statementOf = (r: WorkerPayRow): PayStatement => r.closing?.statement || buildPayStatement(r, data!.from, data!.to)
  const exportable = (list: WorkerPayRow[]): StatementToExport[] =>
    list.map((r) => ({
      statement: statementOf(r),
      note: r.closing ? r.closing.note : notes[r.workerId]?.trim() || null,
      paid: r.paid,
      closed: r.closing ? { by: r.closing.closedBy, at: r.closing.closedAt } : null,
    }))

  const send = async (url: string, method: string, body: unknown, ok: (json: any) => string) => {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch(url, body === null ? { method } : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error || 'No se pudo guardar')
      toast.success(ok(json))
      setAdjust(null)
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo guardar')
    } finally {
      setBusy(false)
    }
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary-600" />
      </div>
    )
  }

  const chosen = rows.filter((r) => selected.has(r.workerId))
  const toClose = chosen.filter((r) => !r.locked)
  // Por correo va solo lo cerrado: lo abierto todavía puede cambiar.
  const toEmail = chosen.filter((r) => r.closing && r.email)
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.workerId))
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const total = (list: WorkerPayRow[]) => list.reduce((sum, r) => sum + statementOf(r).total, 0)
  const ended = data.to <= new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date())

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-gray-600">
          Detalle de pago por funcionario del {day(data.from)} al {day(data.to)}. Marca a quiénes incluir, revisa, descarga y cierra.
        </p>
        <PeriodFilter value={period} onChange={setPeriod} presets={['week', 'month', 'custom']} />
      </div>

      {!data.closingsAvailable && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Falta correr la migración <code>database/migrations/add_pay_closings.sql</code>: se puede revisar y descargar, pero no cerrar el período ni cargar
          descuentos.
        </p>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card className="p-4">
          <p className="text-sm text-gray-500">Funcionarios con movimiento</p>
          <p className="text-2xl font-bold text-gray-900">{rows.length}</p>
          <p className="text-xs text-gray-500">{rows.filter((r) => r.closing).length} con el período cerrado</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-gray-500">Total del período</p>
          <p className="text-2xl font-bold text-gray-900">{clp(total(rows))}</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-gray-500">Seleccionados</p>
          <p className="text-2xl font-bold text-gray-900">{chosen.length}</p>
          <p className="text-xs text-gray-500">{clp(total(chosen))}</p>
        </Card>
        <Card className="border-l-4 border-l-green-500 p-4">
          <p className="text-sm text-gray-500">Pagado en el período</p>
          <p className="text-2xl font-bold text-gray-900">{clp(rows.reduce((sum, r) => sum + r.paid, 0))}</p>
        </Card>
      </div>

      <Card className="flex flex-wrap items-center gap-3 p-4">
        <label className="flex items-center gap-2 text-sm font-semibold text-gray-700">
          <input type="checkbox" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.workerId)))} />
          Seleccionar a todos
        </label>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={chosen.length === 0} onClick={() => downloadStatementsPdf(exportable(chosen))}>
            Descargar PDF
          </Button>
          <Button size="sm" variant="outline" disabled={chosen.length === 0} onClick={() => downloadStatementsCsv(exportable(chosen))}>
            Descargar CSV
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || toEmail.length === 0}
            title="Le manda a cada uno el PDF de su período cerrado, al correo de su ficha"
            onClick={() => {
              const left = chosen.filter((r) => !r.closing || !r.email)
              const leftText = left.length
                ? `\n\nNo van (período sin cerrar o sin correo en su ficha): ${left.map((r) => r.name).join(', ')}.`
                : ''
              if (!window.confirm(`Se manda el detalle de pago del ${day(data.from)} al ${day(data.to)} a:\n${toEmail.map((r) => `• ${r.name} (${r.email})`).join('\n')}${leftText}\n\n¿Enviar?`)) return
              send('/api/admin/worker-pay/email', 'POST', { closingIds: toEmail.map((r) => r.closing!.id) }, (json) => {
                const skipped = (json.skipped || []) as { name: string; reason: string }[]
                if (skipped.length) toast.error(`No se mandó a: ${skipped.map((s) => `${s.name} (${s.reason})`).join(', ')}`, { duration: 10000 })
                return `Detalle enviado por correo a ${json.sent?.length || 0} funcionario${json.sent?.length === 1 ? '' : 's'}`
              })
            }}
          >
            Enviar por correo ({toEmail.length})
          </Button>
          <Button
            size="sm"
            disabled={busy || !data.closingsAvailable || toClose.length === 0 || !ended}
            onClick={() => {
              const names = toClose.map((r) => r.name).join(', ')
              if (!window.confirm(`Se cierra el pago del ${day(data.from)} al ${day(data.to)} de: ${names}.\n\nDespués de cerrar no se pueden cambiar los ajustes de ese período, y sus gastos de contado quedan como reembolsados. Solo un Administrador puede reabrirlo. ¿Cerrar?`)) return
              send(
                '/api/admin/worker-pay/closing',
                'POST',
                { workerIds: toClose.map((r) => r.workerId), from: data.from, to: data.to, notes },
                (json) => `Período cerrado para ${json.closed?.length || 0} funcionario${json.closed?.length === 1 ? '' : 's'}${json.skipped?.length ? ` · ${json.skipped.length} ya tenían un cierre` : ''}`
              )
            }}
          >
            Cerrar período ({toClose.length})
          </Button>
        </div>
        {!ended && <p className="basis-full text-xs text-gray-500">El período todavía no termina: se puede revisar y descargar, y se cierra cuando ya pasó.</p>}
      </Card>

      <Card className="overflow-hidden p-0">
        {rows.length === 0 ? (
          <p className="p-5 text-sm text-gray-500">Ningún funcionario tiene trabajos, gastos ni ajustes en este período.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {rows.map((r) => {
              const s = statementOf(r)
              const open = openId === r.workerId
              return (
                <li key={r.workerId}>
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-5 py-3">
                    <input type="checkbox" checked={selected.has(r.workerId)} onChange={() => toggle(r.workerId)} aria-label={`Seleccionar a ${r.name}`} />
                    <button type="button" onClick={() => setOpenId(open ? null : r.workerId)} aria-expanded={open} className="min-w-0 flex-1 basis-48 text-left">
                      <span className="block text-sm font-semibold text-gray-900 hover:text-primary-600">
                        {r.name} <span className="font-normal text-gray-500">· {r.code}</span>
                        <span
                          className={`ml-2 rounded-full px-2 py-0.5 text-xs font-medium ${
                            r.closing ? 'bg-green-100 text-green-800' : r.locked ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-700'
                          }`}
                        >
                          {r.closing ? 'Cerrado' : r.locked ? 'Parte del período ya está cerrada' : 'Abierto'}
                        </span>
                      </span>
                      <span className="block text-xs text-gray-500">
                        {s.jobsCount} trabajo{s.jobsCount === 1 ? '' : 's'} · {s.ruleLabel} · {open ? 'ocultar detalle' : 'ver detalle'}
                      </span>
                    </button>
                    {(
                      [
                        ['Trabajos', s.jobsTotal],
                        ['Gastos', s.expensesTotal],
                        ['Ajustes', s.adjustmentsTotal],
                        ['Base', s.baseTotal || 0],
                      ] as const
                    ).map(([label, value]) => (
                      <div key={label} className="text-right text-sm">
                        <span className="block text-xs text-gray-500">{label}</span>
                        <span className="text-gray-900">{clp(value)}</span>
                      </div>
                    ))}
                    <div className="text-right text-sm">
                      <span className="block text-xs text-gray-500">Total</span>
                      <span className="font-bold text-gray-900">{clp(s.total)}</span>
                    </div>
                    <div className="text-right text-sm">
                      <span className="block text-xs text-gray-500">Saldo</span>
                      <span className={`font-bold ${s.total - r.paid > 0 ? 'text-orange-700' : 'text-gray-500'}`}>{clp(s.total - r.paid)}</span>
                    </div>
                  </div>

                  {open && (
                    <div className="space-y-4 border-t border-gray-100 bg-gray-50/60 px-5 py-4">
                      {r.closing && (
                        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-900">
                          <span>
                            Cerrado el {day(r.closing.closedAt)}
                            {r.closing.closedBy ? ` por ${r.closing.closedBy}` : ''}. Este detalle es la copia guardada al cerrar.
                          </span>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              if (!window.confirm(`¿Reabrir el pago de ${r.name} del ${day(data.from)} al ${day(data.to)}? Sus gastos vuelven a quedar por reembolsar.`)) return
                              send(`/api/admin/worker-pay/closing?id=${r.closing!.id}`, 'DELETE', null, () => 'Período reabierto')
                            }}
                            className="text-xs font-semibold text-green-900 underline underline-offset-2"
                          >
                            Reabrir (solo Administrador)
                          </button>
                        </div>
                      )}

                      {s.lines.length === 0 ? (
                        <p className="text-sm text-gray-500">Sin movimientos en el período.</p>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                                <th className="py-1 pr-3 font-semibold">Fecha</th>
                                <th className="py-1 pr-3 font-semibold">Tipo</th>
                                <th className="py-1 pr-3 font-semibold">Concepto</th>
                                <th className="py-1 pr-3 font-semibold">Detalle</th>
                                <th className="py-1 text-right font-semibold">Monto</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 text-gray-700">
                              {s.lines.map((l, i) => (
                                <tr key={i}>
                                  <td className="whitespace-nowrap py-1.5 pr-3">{day(l.date)}</td>
                                  <td className="py-1.5 pr-3">{KIND_LABEL[l.kind]}</td>
                                  <td className="py-1.5 pr-3 text-gray-900">{l.label}</td>
                                  <td className="py-1.5 pr-3 text-xs text-gray-500">{l.detail}</td>
                                  <td className="whitespace-nowrap py-1.5 text-right tabular-nums">{clp(l.amount)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {!r.locked && (
                        <div>
                          {r.bonuses.length > 0 && (
                            <p className="mb-2 text-xs text-gray-600">
                              Ajustes cargados:{' '}
                              {r.bonuses.map((b) => (
                                <span key={b.id} className="mr-3 whitespace-nowrap">
                                  {day(b.date)} {clp(b.amount)}{' '}
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => {
                                      if (window.confirm(`¿Quitar el ajuste de ${clp(b.amount)}?`)) send(`/api/admin/worker-pay/bonus?id=${b.id}`, 'DELETE', null, () => 'Ajuste quitado')
                                    }}
                                    className="text-red-600 hover:underline"
                                  >
                                    quitar
                                  </button>
                                </span>
                              ))}
                            </p>
                          )}
                          {adjust?.id === r.workerId ? (
                            <div className="flex flex-wrap items-end gap-2">
                              <div>
                                <label className="mb-1 block text-xs font-medium text-gray-600">Tipo</label>
                                <select
                                  value={adjust.sign}
                                  onChange={(e) => setAdjust({ ...adjust, sign: Number(e.target.value) === -1 ? -1 : 1 })}
                                  className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                                >
                                  <option value={1}>Sumar (bonificación)</option>
                                  <option value={-1}>Descontar</option>
                                </select>
                              </div>
                              <div>
                                <label className="mb-1 block text-xs font-medium text-gray-600">Monto</label>
                                <input
                                  autoFocus
                                  inputMode="numeric"
                                  value={adjust.amount}
                                  onChange={(e) => setAdjust({ ...adjust, amount: e.target.value.replace(/\D/g, '') })}
                                  className="w-28 rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                                />
                              </div>
                              <div>
                                <label className="mb-1 block text-xs font-medium text-gray-600">Fecha</label>
                                <input
                                  type="date"
                                  min={data.from}
                                  max={data.to}
                                  value={adjust.date}
                                  onChange={(e) => setAdjust({ ...adjust, date: e.target.value })}
                                  className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                                />
                              </div>
                              <div className="min-w-0 flex-1">
                                <label className="mb-1 block text-xs font-medium text-gray-600">Motivo</label>
                                <input value={adjust.note} maxLength={300} onChange={(e) => setAdjust({ ...adjust, note: e.target.value })} className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm" />
                              </div>
                              <Button
                                size="sm"
                                disabled={busy || !(Number(adjust.amount) > 0) || !adjust.date || !adjust.note.trim()}
                                onClick={() =>
                                  send(
                                    '/api/admin/worker-pay/bonus',
                                    'POST',
                                    { workerId: r.workerId, amount: adjust.sign * Number(adjust.amount), date: adjust.date, note: adjust.note },
                                    () => 'Ajuste guardado'
                                  )
                                }
                              >
                                Guardar ajuste
                              </Button>
                              <button type="button" onClick={() => setAdjust(null)} className="pb-1.5 text-sm text-gray-500">
                                Cancelar
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setAdjust({ id: r.workerId, sign: 1, amount: '', date: data.to, note: '' })}
                              className="text-sm font-semibold text-primary-600 hover:underline"
                            >
                              + Agregar bonificación o descuento
                            </button>
                          )}
                        </div>
                      )}

                      <div>
                        <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-gray-500">Glosa del pago</label>
                        {r.closing ? (
                          <p className="whitespace-pre-line text-sm text-gray-700">{r.closing.note || 'Sin glosa.'}</p>
                        ) : (
                          <textarea
                            rows={2}
                            maxLength={1000}
                            value={notes[r.workerId] || ''}
                            onChange={(e) => setNotes({ ...notes, [r.workerId]: e.target.value })}
                            placeholder="Resumen que acompaña el detalle: sale en el PDF y queda guardado al cerrar."
                            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                          />
                        )}
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" onClick={() => downloadStatementsPdf(exportable([r]))}>
                          PDF de {r.name.split(' ')[0]}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => downloadStatementsCsv(exportable([r]))}>
                          CSV
                        </Button>
                      </div>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      <p className="text-xs text-gray-500">
        Los gastos se aprueban y se marcan como reembolsados en «Por aprobar». Las tarifas y el registro de pagos están en «Pago a trabajadores». Los m³ y km de
        un trabajo se corrigen en el detalle de la reserva.
      </p>
    </div>
  )
}
