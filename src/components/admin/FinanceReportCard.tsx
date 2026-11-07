'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import toast from 'react-hot-toast'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import { SERVICE_FILTER_LABEL, type FinanceReport, type ServiceFilter } from '@/lib/financeReportTypes'
import { todayChile } from '@/lib/period'

/**
 * Resumen financiero con filtros (Finanzas → Resumen): ingresos, costos, gastos, impuestos,
 * utilidad y rentabilidad de un rango de fechas, por tipo de servicio, cliente o trabajador.
 * El botón de Excel descarga lo mismo con el detalle, respetando los filtros. El rango de
 * fechas lo elige el selector de arriba de Resumen, que manda sobre todo lo que hay en la vista.
 */

const clp = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(Math.round(n)).toLocaleString('es-CL')}`

/** Una cifra de arriba de la vista: nombre, valor y una línea de contexto. */
export function FinanceKpi({ label, value, hint, negative = false }: { label: string; value: ReactNode; hint?: string; negative?: boolean }) {
  return (
    <div className="flex h-full flex-col rounded-xl border border-gray-200 bg-white px-4 py-3">
      <p className="text-sm font-medium text-gray-500">{label}</p>
      <p className={`mt-1 text-lg font-bold tabular-nums sm:text-2xl ${negative ? 'text-red-700' : 'text-gray-900'}`}>{value}</p>
      {hint && <p className="mt-auto pt-1 text-xs text-gray-500">{hint}</p>}
    </div>
  )
}

export default function FinanceReportCard({ from, to }: { from: string; to: string }) {
  const [filters, setFilters] = useState({ servicio: 'todos' as ServiceFilter, cliente: '', trabajador: '' })
  const [report, setReport] = useState<FinanceReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [downloading, setDownloading] = useState(false)

  // Con los botones de mes se cambia rápido: solo vale la respuesta de la última consulta.
  const lastRequest = useRef(0)

  const query = (extra = '') => `/api/admin/finance/report?${new URLSearchParams({ desde: from, hasta: to, ...filters }).toString()}${extra}`

  const load = useCallback(async () => {
    const request = ++lastRequest.current
    setLoading(true)
    try {
      const res = await fetch(query())
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || 'No se pudo cargar el resumen')
      if (request === lastRequest.current) setReport(body)
    } catch (error) {
      if (request === lastRequest.current) toast.error(error instanceof Error ? error.message : 'No se pudo cargar el resumen')
    } finally {
      if (request === lastRequest.current) setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, from, to])

  useEffect(() => {
    load()
  }, [load])

  const download = async () => {
    if (downloading) return
    setDownloading(true)
    try {
      const res = await fetch(query('&formato=xlsx'))
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || 'No se pudo descargar')
      const url = URL.createObjectURL(await res.blob())
      const link = document.createElement('a')
      link.href = url
      link.download = `resumen_financiero_${from}_${to}.xlsx`
      link.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo descargar')
    } finally {
      setDownloading(false)
    }
  }

  const set = (key: keyof typeof filters, value: string) => setFilters((f) => ({ ...f, [key]: value }))
  const line = (label: string, value: number, strong = false, indent = false) => (
    <div className={`flex justify-between gap-4 py-1 ${strong ? 'border-t border-gray-200 font-semibold text-gray-900' : 'text-gray-700'} ${indent ? 'pl-4' : ''}`}>
      <span>{label}</span>
      <span className="tabular-nums">{clp(value)}</span>
    </div>
  )

  // Un cliente o trabajador elegido puede no tener servicios en el período nuevo: sigue filtrado por él.
  const clientMissing = !!filters.cliente && !['empresas', 'personas'].includes(filters.cliente) && !report?.options.clients.some((c) => c.value === filters.cliente)
  const workerMissing = !!filters.trabajador && !report?.options.workers.some((w) => w.id === filters.trabajador)

  return (
    <section className="space-y-4" aria-busy={loading}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h4 className="font-bold text-gray-900">Resultado</h4>
          <p className="text-xs text-gray-500">Por fecha del servicio. Estos tres filtros solo afectan a esta parte y al Excel.</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {loading && <span className="text-xs text-gray-500">Calculando…</span>}
          <select aria-label="Tipo de servicio" value={filters.servicio} onChange={(e) => set('servicio', e.target.value)} className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm">
            {(Object.keys(SERVICE_FILTER_LABEL) as ServiceFilter[]).map((s) => (
              <option key={s} value={s}>
                {SERVICE_FILTER_LABEL[s]}
              </option>
            ))}
          </select>
          <select aria-label="Cliente" value={filters.cliente} onChange={(e) => set('cliente', e.target.value)} className="max-w-[12rem] rounded-lg border border-gray-300 px-2 py-1.5 text-sm">
            <option value="">Todos los clientes</option>
            <option value="empresas">Solo empresas</option>
            <option value="personas">Solo personas</option>
            {clientMissing && <option value={filters.cliente}>Cliente sin servicios en el período</option>}
            {(report?.options.clients || []).map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
          <select aria-label="Trabajador" value={filters.trabajador} onChange={(e) => set('trabajador', e.target.value)} className="max-w-[12rem] rounded-lg border border-gray-300 px-2 py-1.5 text-sm">
            <option value="">Todos los trabajadores</option>
            {workerMissing && <option value={filters.trabajador}>Trabajador sin servicios en el período</option>}
            {(report?.options.workers || []).map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
          <Button size="sm" disabled={downloading || loading || !report} onClick={download}>
            {downloading ? 'Armando Excel…' : 'Descargar Excel'}
          </Button>
        </div>
      </div>

      {report && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <FinanceKpi label="Ingresos netos" value={clp(report.income.net)} hint={`${report.income.services} servicios`} />
            <FinanceKpi label="Costos" value={clp(report.costs.total)} hint="Trabajadores y terreno" />
            <FinanceKpi label="Gastos de la empresa" value={report.filtered ? '—' : clp(report.companyExpensesTotal)} hint={report.filtered ? 'No aplica con filtro' : 'Netos de IVA'} />
            <FinanceKpi label="Utilidad" value={clp(report.result)} negative={report.result < 0} hint={report.to > todayChile() ? 'Inflada: incluye días que aún no pasan, sin su costo' : 'Ingresos − costos − gastos'} />
            <FinanceKpi label="Rentabilidad" value={report.margin === null ? '—' : `${report.margin.toLocaleString('es-CL')} %`} hint="Utilidad / ingresos netos" />
          </div>

          <div className="grid gap-4 text-sm lg:grid-cols-3">
            <Card className="p-5 lg:col-span-2">
              <h4 className="mb-2 font-bold text-gray-900">Estado de resultados</h4>
              {line(`Servicios (${report.income.services}), con IVA`, report.income.gross)}
              {line('IVA débito', -report.income.ivaDebito, false, true)}
              {line('Ingresos netos', report.income.net, true)}
              {line('Pago a trabajadores por trabajos', -report.costs.workerPay, false, true)}
              {!report.filtered && line('Sueldos base', -report.costs.base, false, true)}
              {!report.filtered && line('Bonificaciones y descuentos', -report.costs.adjustments, false, true)}
              {report.costs.retention > 0 && line('Retención boletas de honorarios', -report.costs.retention, false, true)}
              {line('Gastos de terreno', -report.costs.fieldExpenses, false, true)}
              {line('Margen después de costos', report.income.net - report.costs.total, true)}
              {!report.filtered && report.companyExpenses.map((g) => <div key={g.label}>{line(g.label, -g.net, false, true)}</div>)}
              {!report.filtered && line('Gastos de la empresa', -report.companyExpensesTotal, true)}
              {line('Utilidad', report.result, true)}
            </Card>
            <div className="space-y-4">
              <Card className="p-5">
                <h4 className="mb-2 font-bold text-gray-900">Impuestos</h4>
                {line('IVA débito (ventas)', report.taxes.ivaDebito)}
                {line('IVA crédito (gastos de la empresa)', -report.taxes.ivaCredito)}
                {line('IVA a pagar', report.taxes.ivaToPay, true)}
                {line('Retención de honorarios por pagar al SII', report.taxes.honorariosRetention, true)}
                <p className="mt-1 text-xs text-gray-500">
                  La retención de las boletas de honorarios la paga la empresa encima del líquido de cada trabajador: está en los costos y se paga al SII.
                </p>
              </Card>
              {report.notes.length > 0 && (
                <ul className="space-y-1 text-xs text-amber-800">
                  {report.notes.map((n) => (
                    <li key={n} className="rounded bg-amber-50 px-2 py-1">
                      {n}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  )
}
