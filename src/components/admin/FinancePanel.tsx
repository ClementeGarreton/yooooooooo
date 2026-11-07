'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import toast from 'react-hot-toast'
import { INVOICE_STATUS_LABEL } from '@/lib/invoiceTypes'
import type { FinanceBooking, FinanceData } from '@/lib/financeTypes'
import DashboardCharts from './DashboardCharts'
import FinancePeriodPicker, { type FinanceRange } from './FinancePeriodPicker'
import AccountingPanel from './AccountingPanel'
import WorkerPayPanel from './WorkerPayPanel'
import IncomeStatementPanel from './IncomeStatementPanel'
import ExpensesPanel from './ExpensesPanel'
import PayClosingPanel from './PayClosingPanel'
import FinanceReportCard, { FinanceKpi } from './FinanceReportCard'
import { monthRange, todayChile } from '@/lib/period'

/** Lo que Finanzas toma del resumen de Inicio (`/api/admin/stats`) para el mes elegido. */
interface MonthStats {
  revenue?: {
    byOrigin?: { source: string; label: string; paid: number; pending: number; booked: number }[]
  }
  outstandingQuotes?: { total: number; count: number }
}

/**
 * Finanzas: la plata de un período en un solo lugar.
 *  - Arriba, lo reservado, cobrado, por cobrar y facturado.
 *  - «Servicios del período»: uno por uno, con cotizado, ajustes, total, pagado, saldo,
 *    documento y factura.
 * Los montos son por FECHA DEL SERVICIO y salen de las mismas funciones que Inicio y
 * Reservas. Acá no se edita nada: las facturas se emiten en «Emisión de facturas»
 * (`InvoicingPanel`).
 */

const clp = (n: number | null) => `$${Math.round(n || 0).toLocaleString('es-CL')}`
const fmtDate = (d: string | null) => {
  if (!d) return '—'
  const [y, m, day] = d.slice(0, 10).split('-')
  return `${day}-${m}-${y}`
}
const TAX_LABEL: Record<string, string> = {
  boleta: 'Boleta',
  factura: 'Factura',
  sin_documento: 'Sin documento',
}

type Filter = 'all' | 'pending' | 'company' | 'unbilled'

function FinanceSummary({
  from,
  to,
  onOpenBooking,
  onSeeLeads,
}: FinanceRange & {
  onOpenBooking?: (quoteId: string) => void
  /** Lleva a Prospectos (desde «Cotizado vigente»). */
  onSeeLeads?: () => void
}) {
  const [stats, setStats] = useState<MonthStats | null>(null)
  const [data, setData] = useState<FinanceData | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  // Con los botones de mes se cambia rápido: solo vale la respuesta de la última consulta.
  const lastRequest = useRef(0)

  const load = useCallback(async () => {
    const request = ++lastRequest.current
    try {
      const res = await fetch(`/api/admin/finance?desde=${from}&hasta=${to}`)
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || 'No se pudo cargar Finanzas')
      if (request !== lastRequest.current) return
      setData(body)
      // Ingresos por origen y cotizado vigente: el mismo cálculo que tenía Inicio, para
      // el período elegido. Si falla, Finanzas se muestra igual sin esos dos bloques.
      fetch(`/api/admin/stats?desde=${from}&hasta=${to}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((json) => {
          if (request === lastRequest.current) setStats(json)
        })
        .catch(() => {
          if (request === lastRequest.current) setStats(null)
        })
    } catch (error) {
      if (request !== lastRequest.current) return
      toast.error(error instanceof Error ? error.message : 'No se pudo cargar Finanzas')
    }
  }, [from, to])

  useEffect(() => {
    load()
  }, [load])

  const shown = useMemo(() => {
    const list = data?.bookings || []
    if (filter === 'pending') return list.filter((b) => b.pending > 0)
    if (filter === 'company') return list.filter((b) => b.company)
    if (filter === 'unbilled') return list.filter((b) => b.company && !b.invoice && b.total > 0)
    return list
  }, [data, filter])

  const exportCsv = () => {
    if (!data) return
    const esc = (v: unknown) => {
      const s = v == null ? '' : String(v)
      return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const header = [
      'Código',
      'Fecha',
      'Cliente',
      'Empresa',
      'Estado',
      'Cotizado',
      'Ajustes',
      'Total',
      'Pagado',
      'Saldo',
      'Documento',
      'Factura',
    ]
    const rows = shown.map((b: FinanceBooking) => [
      b.code || b.quoteId,
      fmtDate(b.scheduledDate),
      b.clientName,
      b.company?.razon_social || '',
      b.status,
      b.quoted,
      b.adjustments,
      b.total,
      b.paid,
      b.pending,
      b.taxDocument ? TAX_LABEL[b.taxDocument] || b.taxDocument : 'Sin definir',
      b.invoice ? b.invoice.folio || INVOICE_STATUS_LABEL[b.invoice.status] : '',
    ])
    const csv = '﻿' + [header, ...rows].map((r) => r.map(esc).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `finanzas_${data.from}_${data.to}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary-600" />
      </div>
    )
  }

  const s = data.summary
  const channels = [
    { label: 'Flow', value: s.paidByChannel.flow },
    { label: 'Transferencia', value: s.paidByChannel.transfer },
    { label: 'Efectivo', value: s.paidByChannel.cash },
    { label: 'Otro', value: s.paidByChannel.otro },
  ].filter((c) => c.value > 0)
  const channelsTotal = channels.reduce((sum, c) => sum + c.value, 0)

  return (
    <div className="space-y-6">
      <section className="space-y-4">
        <div>
          <h4 className="font-bold text-gray-900">Ingresos y cobros</h4>
          <p className="text-xs text-gray-500">Por fecha del servicio. Montos con IVA.</p>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <FinanceKpi
            label="Reservado"
            value={clp(s.booked)}
            hint={`${data.bookings.length} servicios`}
          />
          <FinanceKpi label="Cobrado" value={clp(s.paid)} hint="Por medio de pago, abajo" />
          <FinanceKpi
            label="Por cobrar"
            value={clp(s.pending)}
            hint={`${s.pendingCount} reservas con saldo`}
          />
          <FinanceKpi
            label="Facturado con Emisso"
            value={clp(s.invoiced)}
            hint={`${s.invoicedCount} factura${s.invoicedCount === 1 ? '' : 's'} emitida${s.invoicedCount === 1 ? '' : 's'}`}
          />
        </div>
      </section>

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <Card className="overflow-hidden p-0 lg:col-span-2">
          <div className="flex items-end justify-between gap-3 border-b border-gray-100 px-5 py-4">
            <div className="min-w-0">
              <h3 className="font-bold text-gray-900">Ingresos por documento tributario</h3>
              <p className="text-xs text-gray-500">
                Servicios del período según lleven factura, boleta o nada. El IVA es el incluido en
                el valor del servicio (total ÷ 1,19).
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-xs text-gray-500">IVA a pagar por documentos</p>
              <p className="text-2xl font-bold text-gray-900">{clp(data.ivaDebito)}</p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-100 text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wider text-gray-500">
                <tr>
                  <th className="px-5 py-2 text-left">Documento</th>
                  <th className="px-5 py-2 text-right">Servicios</th>
                  <th className="px-5 py-2 text-right">Total</th>
                  <th className="px-5 py-2 text-right">Neto</th>
                  <th className="px-5 py-2 text-right">IVA</th>
                  <th className="px-5 py-2 text-right">Cobrado</th>
                  <th className="px-5 py-2 text-right">Por cobrar</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {data.byDocument.map((row) => {
                  const taxed = row.key === 'factura' || row.key === 'boleta'
                  return (
                    <tr key={row.key}>
                      <td className="px-5 py-2 font-medium text-gray-800">{row.label}</td>
                      <td className="px-5 py-2 text-right text-gray-700">{row.count}</td>
                      <td className="px-5 py-2 text-right font-medium text-gray-800">
                        {clp(row.total)}
                      </td>
                      <td className="px-5 py-2 text-right text-gray-700">
                        {taxed ? clp(row.net) : '—'}
                      </td>
                      <td className="px-5 py-2 text-right text-gray-700">
                        {taxed ? clp(row.iva) : '—'}
                      </td>
                      <td className="px-5 py-2 text-right text-green-700">{clp(row.paid)}</td>
                      <td className="px-5 py-2 text-right text-amber-700">{clp(row.pending)}</td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot className="bg-gray-50 text-sm font-semibold text-gray-800">
                <tr>
                  <td className="px-5 py-2" colSpan={2}>
                    Con documento (factura + boleta)
                  </td>
                  <td className="px-5 py-2 text-right">{clp(data.withDocumentTotal)}</td>
                  <td className="px-5 py-2" colSpan={4} />
                </tr>
                <tr>
                  <td className="px-5 py-2" colSpan={2}>
                    Sin documento o sin definir
                  </td>
                  <td className="px-5 py-2 text-right">{clp(data.withoutDocumentTotal)}</td>
                  <td className="px-5 py-2" colSpan={4} />
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>

        <Card className="p-5">
          <h3 className="font-bold text-gray-900">Cómo se cobró</h3>
          {channels.length === 0 ? (
            <p className="mt-2 text-sm text-gray-500">Sin cobros en el período.</p>
          ) : (
            <ul className="mt-3 space-y-3 text-sm">
              {channels.map((c) => (
                <li key={c.label}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-medium text-gray-800">{c.label}</span>
                    <span className="tabular-nums text-gray-900">
                      {clp(c.value)}{' '}
                      <span className="text-xs text-gray-500">
                        {((c.value / channelsTotal) * 100).toLocaleString('es-CL', {
                          maximumFractionDigits: 1,
                        })}{' '}
                        %
                      </span>
                    </span>
                  </div>
                  <span className="mt-1 block h-1.5 overflow-hidden rounded bg-gray-100">
                    <span
                      className="block h-full rounded bg-primary-600"
                      style={{ width: `${(c.value / channelsTotal) * 100}%` }}
                    />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {(stats?.revenue?.byOrigin || stats?.outstandingQuotes) && (
        <div className="grid items-start gap-4 lg:grid-cols-3">
          {stats?.revenue?.byOrigin && (
            <Card className="overflow-hidden p-0 lg:col-span-2">
              <div className="border-b border-gray-100 px-5 py-4">
                <h3 className="font-bold text-gray-900">Ingresos por origen del cliente</h3>
                <p className="text-xs text-gray-500">
                  Cliente antiguo se contabiliza aparte de quienes llegaron por la web.
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-100 text-sm">
                  <thead className="bg-gray-50 text-xs uppercase tracking-wider text-gray-500">
                    <tr>
                      <th className="px-5 py-2 text-left">Origen</th>
                      <th className="px-5 py-2 text-right">Pagado</th>
                      <th className="px-5 py-2 text-right">Por cobrar</th>
                      <th className="px-5 py-2 text-right">Reservado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 bg-white">
                    {stats.revenue.byOrigin.map((row) => (
                      <tr key={row.source}>
                        <td className="px-5 py-2 font-medium text-gray-800">{row.label}</td>
                        <td className="px-5 py-2 text-right text-green-700">{clp(row.paid)}</td>
                        <td className="px-5 py-2 text-right text-amber-700">{clp(row.pending)}</td>
                        <td className="px-5 py-2 text-right font-medium text-gray-800">
                          {clp(row.booked)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
          {stats?.outstandingQuotes && (
            <Card className="h-fit border-l-4 border-l-blue-500 p-5">
              <p className="text-sm text-gray-500">Cotizado vigente · a futuro</p>
              <p className="text-2xl font-bold text-gray-900">
                {clp(stats.outstandingQuotes.total)}
              </p>
              <p className="text-xs text-gray-500">
                {stats.outstandingQuotes.count} cotizaci
                {stats.outstandingQuotes.count === 1 ? 'ón' : 'ones'} sin reserva. Todas las fechas
                futuras, no solo este mes.
              </p>
              {onSeeLeads && (
                <button
                  type="button"
                  onClick={onSeeLeads}
                  className="mt-3 text-sm font-semibold text-primary-600 hover:underline"
                >
                  Ver prospectos →
                </button>
              )}
            </Card>
          )}
        </div>
      )}

      <Card className="overflow-hidden p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 p-4">
          <h3 className="text-lg font-bold text-gray-900">Servicios del período</h3>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={shown.length === 0}>
              Exportar CSV
            </Button>
            <div className="flex flex-wrap gap-1 rounded-xl bg-gray-100 p-1 text-sm">
              {(
                [
                  ['all', 'Todos'],
                  ['pending', 'Con saldo'],
                  ['company', 'De empresas'],
                  ['unbilled', 'Sin facturar'],
                ] as const
              ).map(([id, label]) => (
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
          </div>
        </div>
        {shown.length === 0 ? (
          <p className="p-6 text-sm text-gray-500">No hay servicios para este filtro.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 text-xs font-medium uppercase tracking-wider text-gray-500">
                <tr>
                  <th className="px-4 py-2 text-left">Servicio</th>
                  <th className="px-4 py-2 text-left">Cliente</th>
                  <th className="px-4 py-2 text-right">Cotizado</th>
                  <th className="px-4 py-2 text-right">Ajustes</th>
                  <th className="px-4 py-2 text-right">Total</th>
                  <th className="px-4 py-2 text-right">Pagado</th>
                  <th className="px-4 py-2 text-right">Saldo</th>
                  <th className="px-4 py-2 text-left">Documento</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {shown.map((b) => (
                  <tr key={b.id} className="hover:bg-gray-50">
                    <td className="whitespace-nowrap px-4 py-2">
                      {onOpenBooking && b.quoteId ? (
                        <button
                          type="button"
                          onClick={() => onOpenBooking(b.quoteId!)}
                          className="font-semibold text-primary-600 hover:underline"
                        >
                          {b.code || b.quoteId}
                        </button>
                      ) : (
                        <span className="font-semibold text-gray-900">{b.code || b.quoteId}</span>
                      )}
                      <span className="block text-xs text-gray-500">
                        {fmtDate(b.scheduledDate)}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      <span className="text-gray-900">{b.clientName}</span>
                      {b.company && (
                        <span className="block text-xs text-gray-500">
                          {b.company.razon_social}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-right text-gray-700">
                      {clp(b.quoted)}
                    </td>
                    <td
                      className={`whitespace-nowrap px-4 py-2 text-right ${b.adjustments > 0 ? 'text-amber-700' : b.adjustments < 0 ? 'text-blue-700' : 'text-gray-400'}`}
                    >
                      {b.adjustments === 0
                        ? '—'
                        : `${b.adjustments > 0 ? '+' : '−'}${clp(Math.abs(b.adjustments))}`}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-right font-semibold text-gray-900">
                      {clp(b.total)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-right text-green-700">
                      {clp(b.paid)}
                    </td>
                    <td
                      className={`whitespace-nowrap px-4 py-2 text-right font-semibold ${b.pending > 0 ? 'text-orange-700' : 'text-gray-400'}`}
                    >
                      {b.pending > 0 ? clp(b.pending) : '—'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-gray-700">
                      {b.invoice
                        ? b.invoice.folio
                          ? `Factura folio ${b.invoice.folio}`
                          : INVOICE_STATUS_LABEL[b.invoice.status]
                        : b.taxDocument
                          ? TAX_LABEL[b.taxDocument] || b.taxDocument
                          : 'Sin definir'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="border-t border-gray-100 px-4 py-2 text-xs text-gray-500">
          {shown.length} de {data.bookings.length} servicios. No incluye reservas canceladas,
          bloqueos de agenda ni pre-reservas sin pagar.
        </p>
      </Card>

      {/* Reservas e ingresos de los últimos meses (antes estaba en Inicio). No dependen del período elegido. */}
      <section className="space-y-3">
        <div>
          <h4 className="font-bold text-gray-900">Histórico</h4>
          <p className="text-xs text-gray-500">
            Los gráficos de abajo muestran varios meses: no cambian con el período elegido.
          </p>
        </div>
        <DashboardCharts />
      </section>
    </div>
  )
}

/** Título y período de Resumen: el selector manda sobre todo lo que hay debajo. */
function FinanceResumen(props: {
  onOpenBooking?: (quoteId: string) => void
  onSeeLeads?: () => void
}) {
  const [range, setRange] = useState<FinanceRange>(() => {
    const month = monthRange(todayChile())
    return { from: month.from, to: month.to }
  })
  const today = todayChile()
  const month = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
    .map((back) => monthRange(today, back))
    .find((m) => m.from === range.from && m.to === range.to)
  const label = month ? month.name : `${fmtDate(range.from)} al ${fmtDate(range.to)}`
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-bold text-gray-900">Resumen de {label}</h3>
        <FinancePeriodPicker value={range} onChange={setRange} />
      </div>
      <FinanceReportCard from={range.from} to={range.to} />
      <FinanceSummary from={range.from} to={range.to} {...props} />
    </div>
  )
}

type FinanceView = 'summary' | 'income' | 'expenses' | 'accounting' | 'workers' | 'closing'

const VIEWS: [FinanceView, string][] = [
  ['summary', 'Resumen'],
  ['income', 'EERR'],
  ['expenses', 'Gastos'],
  ['accounting', 'IVA y banco'],
  ['workers', 'Pago a trabajadores'],
  ['closing', 'Cierre de pagos'],
]

/**
 * Finanzas, en cinco vistas: el resumen de lo reservado y cobrado, el estado de resultados,
 * los gastos, la contabilidad con datos del SII y del banco (IVA del mes, movimientos), y el
 * pago a trabajadores por trabajos hechos.
 */
export default function FinancePanel({
  allowed,
  ...props
}: {
  onOpenBooking?: (quoteId: string) => void
  onSeeLeads?: () => void
  /** ¿El perfil ve esta pestaña? Sin esto, las ve todas. */
  allowed?: (section: string) => boolean
}) {
  const views = VIEWS.filter(([id]) => !allowed || allowed(id))
  const [chosen, setView] = useState<FinanceView>('summary')
  // Si la pestaña elegida no está permitida, se muestra la primera que sí.
  const view = views.some(([id]) => id === chosen) ? chosen : views[0]?.[0]
  if (!view)
    return (
      <p className="text-sm text-gray-600">
        Tu perfil no tiene ninguna pestaña de Finanzas activa.
      </p>
    )
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-bold text-gray-900">Finanzas</h2>
        <div className="flex flex-wrap gap-1 rounded-xl bg-gray-100 p-1 text-sm">
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
      {view === 'summary' ? (
        <FinanceResumen {...props} />
      ) : view === 'income' ? (
        <IncomeStatementPanel />
      ) : view === 'expenses' ? (
        <ExpensesPanel />
      ) : view === 'accounting' ? (
        <AccountingPanel />
      ) : view === 'closing' ? (
        <PayClosingPanel />
      ) : (
        <WorkerPayPanel />
      )}
    </div>
  )
}
