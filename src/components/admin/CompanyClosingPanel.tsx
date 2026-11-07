'use client'

import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import Button from '@/components/ui/Button'
import {
  CLOSING_UNIT_LABEL,
  tariffLabel,
  tariffSummary,
  type ClosingRow,
  type ClosingSnapshot,
  type ClosingUnit,
  type CompanyClosingData,
  type TariffCurrency,
} from '@/lib/companyClosingTypes'

/**
 * Tarifa y cierre de una empresa por pallets o kilos (Monfiza), en su ficha del admin.
 * Arriba la tarifa por tramos (precio por cada N pallets o N kilos, y recargo de urgencia),
 * en UF o pesos. Abajo el cierre del período: cada trabajo con lo que anotó el trabajador
 * (corregible), por pallets o kilos, si fue urgente y sus tramos y monto neto. Guardar el
 * cierre deja cada reserva con su monto; con tarifa en UF, los pesos se fijan al facturar.
 */

const clp = (n: number) => `$${Math.round(n).toLocaleString('es-CL')}`
const uf = (n: number) => `${n.toLocaleString('es-CL', { maximumFractionDigits: 4 })} UF`
const day = (d: string) => d.slice(0, 10).split('-').reverse().join('-')
const todayChile = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date())
const firstOfPrevMonth = () => {
  const [y, m] = todayChile().split('-').map(Number)
  return m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, '0')}-01`
}
const lastOfMonth = (first: string) => {
  const [y, m] = first.split('-').map(Number)
  return `${first.slice(0, 8)}${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`
}
const decimal = (v: string) => v.replace(/[^\d,]/g, '')
const toInput = (n: number | null) => (n === null ? '' : String(n).replace('.', ','))
const fromInput = (v: string) => (v === '' ? null : v.replace(',', '.'))

async function api(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.error || 'No se pudo completar la acción')
  return data
}

interface TariffForm {
  closingUnit: ClosingUnit | ''
  currency: TariffCurrency
  tramoPrice: string
  tramoPallets: string
  tramoKg: string
  urgencyPrice: string
}

/**
 * `canReopen` solo esconde el botón: reabrir lo valida el servidor (solo Administrador).
 * `onChanged` avisa al panel de la empresa que algo cambió (cierre guardado, entrega corregida).
 */
export default function CompanyClosingPanel({ companyId, canReopen = true, onChanged }: { companyId: string; canReopen?: boolean; onChanged?: () => void }) {
  // Por defecto, el mes anterior: lo que normalmente se cierra.
  const [period, setPeriod] = useState(() => ({ from: firstOfPrevMonth(), to: lastOfMonth(firstOfPrevMonth()) }))
  const [ufInput, setUfInput] = useState('')
  const [data, setData] = useState<CompanyClosingData | null>(null)
  const [tariff, setTariff] = useState<TariffForm | null>(null)
  const [edit, setEdit] = useState<{ id: string; pallets: string; kg: string; odNumber: string; guideNumber: string; note: string } | null>(null)
  const [busy, setBusy] = useState(false)
  /** Texto de avance mientras se arma el PDF con fotos. */
  const [pdfBusy, setPdfBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ desde: period.from, hasta: period.to, ...(ufInput ? { uf: ufInput.replace(',', '.') } : {}) })
      const body: CompanyClosingData = await api(`/api/admin/companies/${companyId}/closing?${params}`, 'GET')
      setData(body)
      setTariff(
        (t) =>
          t ?? {
            closingUnit: body.tariff.closingUnit || '',
            currency: body.tariff.currency,
            tramoPrice: toInput(body.tariff.tramoPrice),
            tramoPallets: toInput(body.tariff.tramoPallets),
            tramoKg: toInput(body.tariff.tramoKg),
            urgencyPrice: toInput(body.tariff.urgencyPrice),
          }
      )
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo cargar el cierre')
    }
  }, [companyId, period, ufInput])

  useEffect(() => {
    load()
  }, [load])

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    if (busy) return
    setBusy(true)
    try {
      await fn()
      toast.success(ok)
      setEdit(null)
      await load()
      onChanged?.()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo guardar')
    } finally {
      setBusy(false)
    }
  }

  const download = async (url: string, name: string) => {
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || 'No se pudo descargar')
      const href = URL.createObjectURL(await res.blob())
      const link = document.createElement('a')
      link.href = href
      link.download = name
      link.click()
      URL.revokeObjectURL(href)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo descargar')
    }
  }

  /** PDF del cierre (el de pantalla o uno guardado), con las fotos de cada trabajo. */
  const downloadPdf = async (snapshot: ClosingSnapshot) => {
    setPdfBusy('Armando el PDF…')
    try {
      const { buildCompanyClosingPdf } = await import('@/lib/companyClosingPdf')
      const blob = await buildCompanyClosingPdf(snapshot, setPdfBusy)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `cierre_${snapshot.company.code}_${snapshot.from}_${snapshot.to}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('No se pudo armar el PDF')
    } finally {
      setPdfBusy(null)
    }
  }

  if (!data || !tariff) return <p className="text-sm text-gray-500">Cargando…</p>
  if (!data.available) {
    return (
      <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
        Falta correr la migración <code>database/migrations/add_cierre_empresas.sql</code> para definir la tarifa y cerrar por pallets o kilos.
      </p>
    )
  }

  const inUf = data.tariff.currency === 'UF'
  const net = (n: number) => (inUf ? uf(n) : clp(n))
  const select = 'rounded-lg border border-gray-300 px-2 py-1.5 text-sm'
  const input = 'w-24 rounded-lg border border-gray-300 px-2 py-1.5 text-sm'
  const locked = Boolean(data.overlapping)
  const saveRow = (r: ClosingRow, body: Record<string, unknown>, ok: string) =>
    run(() => api(`/api/admin/companies/${companyId}/closing/booking`, 'PATCH', { bookingId: r.bookingId, ...body }), ok)
  const saveTariff = () =>
    run(
      () =>
        api(`/api/admin/companies/${companyId}/tariff`, 'PUT', {
          closingUnit: tariff.closingUnit || null,
          currency: tariff.currency,
          tramoPrice: fromInput(tariff.tramoPrice),
          tramoPallets: fromInput(tariff.tramoPallets),
          tramoKg: fromInput(tariff.tramoKg),
          urgencyPrice: fromInput(tariff.urgencyPrice),
        }),
      'Tarifa guardada'
    )

  return (
    <div className="space-y-5">
      {/* Tarifa */}
      <div className="rounded-lg border border-gray-200 p-3">
        <p className="mb-2 text-sm font-semibold text-gray-900">Tarifa (montos netos, + IVA)</p>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Se cierra normalmente por</label>
            <select value={tariff.closingUnit} onChange={(e) => setTariff({ ...tariff, closingUnit: e.target.value as ClosingUnit | '' })} className={select}>
              <option value="">No se cierra por unidad</option>
              <option value="pallets">Pallets</option>
              <option value="kg">Kilos</option>
            </select>
          </div>
          {tariff.closingUnit && (
            <>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Moneda</label>
                <select value={tariff.currency} onChange={(e) => setTariff({ ...tariff, currency: e.target.value as TariffCurrency })} className={select}>
                  <option value="UF">UF</option>
                  <option value="CLP">Pesos</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Precio por tramo</label>
                <input inputMode="decimal" value={tariff.tramoPrice} onChange={(e) => setTariff({ ...tariff, tramoPrice: decimal(e.target.value) })} className={input} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Tramo: hasta … pallets</label>
                <input inputMode="decimal" value={tariff.tramoPallets} onChange={(e) => setTariff({ ...tariff, tramoPallets: decimal(e.target.value) })} className={input} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">o hasta … kg</label>
                <input inputMode="decimal" value={tariff.tramoKg} onChange={(e) => setTariff({ ...tariff, tramoKg: decimal(e.target.value) })} className={input} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Recargo urgencia</label>
                <input inputMode="decimal" value={tariff.urgencyPrice} onChange={(e) => setTariff({ ...tariff, urgencyPrice: decimal(e.target.value) })} className={input} />
              </div>
            </>
          )}
          <Button size="sm" disabled={busy} onClick={saveTariff}>
            Guardar tarifa
          </Button>
        </div>
        <p className="mt-2 text-xs text-gray-500">
          Vigente: {tariffSummary(data.tariff)}. Si un servicio pasa el tope del tramo, se cobra otro tramo. En cada trabajo de la empresa el trabajador anota en
          /trabajos los pallets o kilos, el N° de OD, el N° de guía o factura y una foto de la recepción.
        </p>
      </div>

      {data.tariff.closingUnit && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Desde</label>
              <input type="date" value={period.from} max={period.to} onChange={(e) => setPeriod({ ...period, from: e.target.value })} className={select} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Hasta</label>
              <input type="date" value={period.to} min={period.from} onChange={(e) => setPeriod({ ...period, to: e.target.value })} className={select} />
            </div>
            {inUf && (
              <>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">UF para los pesos de referencia</label>
                  <input
                    inputMode="decimal"
                    value={ufInput}
                    placeholder={data.uf ? data.uf.value.toLocaleString('es-CL', { maximumFractionDigits: 2 }) : 'escribir'}
                    onChange={(e) => setUfInput(decimal(e.target.value))}
                    className="w-32 rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                  />
                </div>
                <p className="pb-1.5 text-xs text-gray-500">
                  {data.uf ? `UF de hoy: ${clp(data.uf.value)}${data.uf.source === 'manual' ? ' (escrita a mano)' : ' (mindicador.cl)'}. ` : ''}
                  Los pesos son referenciales: se fijan al facturar, con la UF del día de la factura.
                </p>
              </>
            )}
          </div>

          {data.overlapping && (
            <p className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-800">
              Este período se cruza con el cierre guardado del {day(data.overlapping.from)} al {day(data.overlapping.to)}: sus trabajos ya no se editan.
            </p>
          )}
          {data.totals.incomplete > 0 && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {data.totals.incomplete} trabajo{data.totals.incomplete === 1 ? '' : 's'} con datos incompletos (ver «Falta» en cada uno).
            </p>
          )}

          {data.outside && (
            <div className="flex flex-wrap items-center gap-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
              <p className="flex-1">
                Fuera de estas fechas hay {data.outside.count} trabajo{data.outside.count === 1 ? '' : 's'} sin cerrar
                {data.outside.withFiles > 0 ? ` (${data.outside.withFiles} con fotos o documentos)` : ''}, entre el {day(data.outside.from)} y el{' '}
                {day(data.outside.to)}. No aparecen abajo porque el período no los incluye.
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setPeriod({
                    from: data.outside!.from < period.from ? data.outside!.from : period.from,
                    to: data.outside!.to > period.to ? data.outside!.to : period.to,
                  })
                }
              >
                Ver todos
              </Button>
            </div>
          )}

          {data.rows.length === 0 ? (
            <p className="text-sm text-gray-500">No hay trabajos de la empresa en el período.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-gray-200">
              <table className="w-full min-w-[980px] text-sm">
                <thead className="bg-gray-50 text-left text-xs text-gray-500">
                  <tr>
                    <th className="px-3 py-2 font-medium">Fecha</th>
                    <th className="px-3 py-2 font-medium">Trabajo</th>
                    <th className="px-3 py-2 font-medium">Se cobra por</th>
                    <th className="px-3 py-2 font-medium">Pallets</th>
                    <th className="px-3 py-2 font-medium">Kilos</th>
                    <th className="px-3 py-2 font-medium">Tramos</th>
                    <th className="px-3 py-2 font-medium">N° OD</th>
                    <th className="px-3 py-2 font-medium">N° guía o factura</th>
                    <th className="px-3 py-2 font-medium">Fotos</th>
                    <th className="px-3 py-2 font-medium">Urgente</th>
                    <th className="px-3 py-2 font-medium">Repal.</th>
                    <th className="px-3 py-2 text-right font-medium">Neto</th>
                    <th className="px-3 py-2 font-medium" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {data.rows.map((r) => {
                    const editing = edit?.id === r.bookingId ? edit : null
                    const cell = 'w-20 rounded border border-gray-300 px-1 py-1'
                    return (
                      <tr key={r.bookingId} className={r.missing.length > 0 ? 'bg-amber-50/40' : ''}>
                        <td className="whitespace-nowrap px-3 py-2">{day(r.date)}</td>
                        <td className="px-3 py-2">
                          {r.code || 'Reserva'}
                          <span className="block text-xs text-gray-500">{r.customer || r.requestedBy}</span>
                          {r.missing.length > 0 && <span className="block text-xs text-amber-700">Falta: {r.missing.join(', ')}</span>}
                          {editing ? (
                            <textarea
                              value={editing.note}
                              maxLength={300}
                              rows={2}
                              placeholder="Observaciones para el cierre"
                              onChange={(e) => setEdit({ ...editing, note: e.target.value })}
                              className="mt-1 block w-56 rounded border border-gray-300 px-1 py-1 text-xs"
                            />
                          ) : (
                            r.note && <span className="mt-0.5 block max-w-xs text-xs italic text-gray-600">Obs.: {r.note}</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <select
                            value={r.unit}
                            disabled={busy || locked}
                            onChange={(e) => saveRow(r, { unit: e.target.value }, `Se cobra por ${e.target.value === 'kg' ? 'kilos' : 'pallets'}`)}
                            className="rounded border border-gray-300 px-1 py-1 text-sm"
                          >
                            <option value="pallets">Pallets</option>
                            <option value="kg">Kilos</option>
                          </select>
                        </td>
                        {editing ? (
                          <>
                            <td className="px-3 py-2">
                              <input inputMode="numeric" value={editing.pallets} onChange={(e) => setEdit({ ...editing, pallets: e.target.value.replace(/\D/g, '') })} className={cell} />
                            </td>
                            <td className="px-3 py-2">
                              <input inputMode="decimal" value={editing.kg} onChange={(e) => setEdit({ ...editing, kg: decimal(e.target.value) })} className={cell} />
                            </td>
                            <td className="px-3 py-2 tabular-nums">{r.tramos}</td>
                            <td className="px-3 py-2">
                              <input value={editing.odNumber} maxLength={40} onChange={(e) => setEdit({ ...editing, odNumber: e.target.value })} className="w-24 rounded border border-gray-300 px-1 py-1" />
                            </td>
                            <td className="px-3 py-2">
                              <input value={editing.guideNumber} maxLength={40} onChange={(e) => setEdit({ ...editing, guideNumber: e.target.value })} className="w-28 rounded border border-gray-300 px-1 py-1" />
                            </td>
                          </>
                        ) : (
                          <>
                            <td className={`px-3 py-2 tabular-nums ${r.unit === 'pallets' ? 'font-semibold' : 'text-gray-400'}`}>{r.pallets ?? '—'}</td>
                            <td className={`px-3 py-2 tabular-nums ${r.unit === 'kg' ? 'font-semibold' : 'text-gray-400'}`}>{r.kg ?? '—'}</td>
                            <td className="px-3 py-2 tabular-nums">{r.tramos}</td>
                            <td className="px-3 py-2">{r.odNumber || '—'}</td>
                            <td className="px-3 py-2">{r.guideNumber || '—'}</td>
                          </>
                        )}
                        <td className="px-3 py-2">
                          {r.receptionPhotos.length === 0
                            ? '—'
                            : r.receptionPhotos.map((p, i) => (
                                <a key={p.id} href={`/api/admin/documents/${p.id}`} target="_blank" rel="noreferrer" className="mr-1 text-primary-600 underline">
                                  ver{r.receptionPhotos.length > 1 ? ` ${i + 1}` : ''}
                                </a>
                              ))}
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            aria-label="Urgente"
                            checked={r.urgent}
                            disabled={busy || locked}
                            onChange={(e) => saveRow(r, { urgent: e.target.checked }, e.target.checked ? 'Marcado urgente' : 'Ya no es urgente')}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            aria-label="Repaletizado"
                            checked={r.repalletize}
                            disabled={busy || locked}
                            onChange={(e) => saveRow(r, { repalletize: e.target.checked }, e.target.checked ? 'Marcado repaletizado' : 'Sin repaletizado')}
                          />
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums">
                          {net(r.net)}
                          {inUf && r.netClp > 0 && <span className="block text-xs font-normal text-gray-500">≈ {clp(r.netClp)}</span>}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-xs">
                          {editing ? (
                            <>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                  saveRow(
                                    r,
                                    {
                                      pallets: editing.pallets === '' ? null : editing.pallets,
                                      kg: fromInput(editing.kg),
                                      odNumber: editing.odNumber,
                                      guideNumber: editing.guideNumber,
                                      // Solo si cambió: sin la migración, guardar la nota da error.
                                      ...(editing.note.trim() !== (r.note || '') ? { note: editing.note } : {}),
                                    },
                                    'Entrega corregida'
                                  )
                                }
                                className="font-semibold text-primary-600 hover:underline"
                              >
                                Guardar
                              </button>{' '}
                              <button type="button" onClick={() => setEdit(null)} className="text-gray-500">
                                Cancelar
                              </button>
                            </>
                          ) : (
                            !locked && (
                              <button
                                type="button"
                                onClick={() =>
                                  setEdit({
                                    id: r.bookingId,
                                    pallets: r.pallets !== null ? String(r.pallets) : '',
                                    kg: toInput(r.kg),
                                    odNumber: r.odNumber || '',
                                    guideNumber: r.guideNumber || '',
                                    note: r.note || '',
                                  })
                                }
                                className="text-primary-600 hover:underline"
                              >
                                corregir
                              </button>
                            )
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot className="bg-gray-50 font-semibold">
                  <tr>
                    <td className="px-3 py-2" colSpan={3}>
                      {data.totals.jobs} trabajos
                    </td>
                    <td className="px-3 py-2 tabular-nums">{data.totals.pallets.toLocaleString('es-CL')}</td>
                    <td className="px-3 py-2 tabular-nums">{data.totals.kg.toLocaleString('es-CL')}</td>
                    <td className="px-3 py-2 tabular-nums">{data.totals.tramos}</td>
                    <td className="px-3 py-2" colSpan={3} />
                    <td className="px-3 py-2">{data.totals.urgentCount}</td>
                    <td className="px-3 py-2">{data.totals.repalletizeCount}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                      {net(data.totals.net)}
                      {inUf && data.totals.netClp > 0 && <span className="block text-xs font-normal text-gray-500">≈ {clp(data.totals.netClp)}</span>}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          <p className="text-xs text-gray-500">
            Neto: tramos × {tariffLabel(data.tariff.tramoPrice, data.tariff.currency)} + urgencias × {tariffLabel(data.tariff.urgencyPrice, data.tariff.currency)}. La factura
            agrega IVA. Al cerrar, cada reserva queda con su monto{inUf ? ' en UF; los pesos se fijan al emitir la factura, con la UF de ese día' : ''}.
          </p>
          {data.totals.repalletizeCount > 0 && (
            <p className="text-xs font-semibold text-gray-700">
              Repaletizado: {data.totals.repalletizeCount} ×{' '}
              {data.repalletizePrice ? clp(data.repalletizePrice) : 'monto sin definir (Configuración → Precios)'}
              {data.totals.repalletizeClp > 0 ? ` = ${clp(data.totals.repalletizeClp)} neto, aparte del monto en ${inUf ? 'UF' : 'pesos'}` : ''}. Todavía no entra
              sola en la factura: hay que sumarlo a mano.
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={data.rows.length === 0}
              onClick={() =>
                download(
                  `/api/admin/companies/${companyId}/closing?${new URLSearchParams({ desde: period.from, hasta: period.to, formato: 'xlsx', ...(ufInput ? { uf: ufInput.replace(',', '.') } : {}) })}`,
                  `cierre_${data.company.code}_${period.from}_${period.to}.xlsx`
                )
              }
            >
              Descargar Excel
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || pdfBusy !== null || data.rows.length === 0}
              onClick={() => downloadPdf(data)}
            >
              {pdfBusy || 'Descargar PDF con fotos'}
            </Button>
            <Button
              size="sm"
              disabled={busy || locked || data.rows.length === 0}
              onClick={() => {
                const warn = data.totals.incomplete > 0 ? `\n\nOjo: ${data.totals.incomplete} trabajo(s) con datos incompletos.` : ''
                if (!window.confirm(`¿Cerrar ${data.company.razonSocial} del ${day(period.from)} al ${day(period.to)} por ${net(data.totals.net)} + IVA?${warn}\n\nCada reserva queda con su monto y sus trabajos ya no se editan.`)) return
                run(() => api(`/api/admin/companies/${companyId}/closing`, 'POST', { from: period.from, to: period.to, uf: ufInput ? ufInput.replace(',', '.') : undefined }), 'Cierre guardado')
              }}
            >
              Cerrar período
            </Button>
          </div>
        </div>
      )}

      {data.closings.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-bold uppercase tracking-wide text-gray-500">Cierres guardados</p>
          <ul className="space-y-1 text-sm text-gray-700">
            {data.closings.map((c) => (
              <li key={c.id} className={c.reopenedAt ? 'text-gray-400 line-through' : ''}>
                {day(c.from)} al {day(c.to)} · {CLOSING_UNIT_LABEL[c.unit]}
                <span className="text-xs text-gray-500"> · {[c.closedBy, day(c.closedAt)].filter(Boolean).join(', ')}</span>{' '}
                {!c.reopenedAt && (
                  <>
                    <button
                      type="button"
                      onClick={() => download(`/api/admin/companies/${companyId}/closing?cierre=${c.id}`, `cierre_${data.company.code}_${c.from}_${c.to}.xlsx`)}
                      className="text-xs text-primary-600 hover:underline"
                    >
                      Excel
                    </button>
                    {/* El PDF para cobrarle a la empresa, tal como quedó el cierre. */}
                    <button
                      type="button"
                      disabled={pdfBusy !== null}
                      onClick={async () => {
                        try {
                          await downloadPdf(await api(`/api/admin/companies/${companyId}/closing?cierre=${c.id}&formato=json`, 'GET'))
                        } catch (error) {
                          toast.error(error instanceof Error ? error.message : 'No se pudo armar el PDF')
                        }
                      }}
                      className="ml-2 text-xs text-primary-600 hover:underline disabled:opacity-50"
                    >
                      PDF
                    </button>
                    {canReopen && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          if (window.confirm('¿Reabrir este cierre? Sus trabajos se vuelven a poder editar y las reservas no facturadas quedan sin monto.')) {
                            run(() => api(`/api/admin/companies/${companyId}/closing?id=${c.id}`, 'DELETE'), 'Cierre reabierto')
                          }
                        }}
                        className="ml-2 text-xs text-red-600 hover:underline"
                      >
                        reabrir
                      </button>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
