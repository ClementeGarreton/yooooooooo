'use client'

import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import Card from '@/components/ui/Card'
import PeriodFilter from './PeriodFilter'
import { periodOf, resolvePeriod, type Period } from '@/lib/period'
import type { IncomeStatement } from '@/lib/incomeStatementTypes'
import BankReconciliationCard from './BankReconciliationCard'
import MonthlyIncomeStatement from './MonthlyIncomeStatement'

/**
 * Finanzas → EERR: estado de resultados de gestión del período, por fecha del servicio.
 * Ingresos netos − costo del servicio (pago a trabajadores y gastos de terreno) − gastos de
 * la empresa. Se arma con lo que hay en el panel; no reemplaza la contabilidad del contador.
 */

const clp = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(Math.round(n)).toLocaleString('es-CL')}`
const day = (d: string) => d.slice(0, 10).split('-').reverse().join('-')

function Line({ label, value, strong, indent, minus, hint }: { label: string; value: number; strong?: boolean; indent?: boolean; minus?: boolean; hint?: string }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 py-2 ${strong ? 'border-t border-gray-200 font-bold text-gray-900' : 'text-gray-700'}`}>
      <span className={indent ? 'pl-4 text-sm' : 'text-sm'}>
        {label}
        {hint && <span className="block text-xs font-normal text-gray-500">{hint}</span>}
      </span>
      <span className={`shrink-0 tabular-nums ${strong ? 'text-base' : 'text-sm'} ${strong && value < 0 ? 'text-red-700' : ''}`}>
        {minus && value !== 0 ? `−${clp(value)}` : clp(value)}
      </span>
    </div>
  )
}

/**
 * EERR en dos vistas: «Mes a mes» (la principal: un mes por columna, para comparar márgenes)
 * y «Un período» (el detalle de un rango de fechas, con el cruce del banco).
 */
export default function IncomeStatementPanel() {
  const [mode, setMode] = useState<'monthly' | 'period'>('monthly')
  return (
    <div className="space-y-6">
      <div className="flex gap-1 self-start rounded-xl bg-gray-100 p-1 text-sm sm:w-fit">
        {(
          [
            ['monthly', 'Mes a mes'],
            ['period', 'Un período'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setMode(id)}
            aria-pressed={mode === id}
            className={`rounded-lg px-3 py-1.5 font-semibold ${mode === id ? 'bg-white text-primary-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {mode === 'monthly' ? <MonthlyIncomeStatement /> : <PeriodIncomeStatement />}
    </div>
  )
}

function PeriodIncomeStatement() {
  const [period, setPeriod] = useState<Period>(periodOf('month'))
  const resolved = resolvePeriod(period)
  const month = resolvePeriod(periodOf('month'))
  const from = resolved.from && resolved.to ? resolved.from : (month.from as string)
  const to = resolved.from && resolved.to ? resolved.to : (month.to as string)
  const [data, setData] = useState<IncomeStatement | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/accounting/income-statement?desde=${from}&hasta=${to}`)
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || 'No se pudo calcular')
      setData(body)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo calcular')
    }
  }, [from, to])

  useEffect(() => {
    load()
  }, [load])

  if (!data) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary-600" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-gray-600">
          Estado de resultados del {day(data.from)} al {day(data.to)}, por fecha del servicio ({data.services} servicio{data.services === 1 ? '' : 's'}).
        </p>
        <PeriodFilter value={period} onChange={setPeriod} presets={['month', 'custom']} />
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card className="p-4">
          <p className="text-sm text-gray-500">Ingresos netos</p>
          <p className="text-2xl font-bold text-gray-900">{clp(data.netRevenue)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-gray-500">Costo del servicio</p>
          <p className="text-2xl font-bold text-gray-900">{clp(data.workerPay + data.fieldExpenses)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-gray-500">Gastos de la empresa</p>
          <p className="text-2xl font-bold text-gray-900">{clp(data.companyExpensesTotal)}</p>
        </Card>
        <Card className={`border-l-4 p-4 ${data.result >= 0 ? 'border-l-green-500' : 'border-l-red-500'}`}>
          <p className="text-sm text-gray-500">Resultado</p>
          <p className={`text-2xl font-bold ${data.result >= 0 ? 'text-gray-900' : 'text-red-700'}`}>{clp(data.result)}</p>
          {data.margin !== null && <p className="text-xs text-gray-500">{data.margin.toLocaleString('es-CL')} % de los ingresos netos</p>}
        </Card>
      </div>

      {data.undefinedDocCount > 0 && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {data.undefinedDocCount} servicio{data.undefinedDocCount === 1 ? '' : 's'} por {clp(data.undefinedDocTotal)} no {data.undefinedDocCount === 1 ? 'tiene' : 'tienen'} definido
          si {data.undefinedDocCount === 1 ? 'va' : 'van'} con boleta, factura o sin documento, así que su IVA no está descontado y los ingresos netos
          pueden estar inflados. Se define en cada reserva. El IVA real del mes está en «IVA y banco».
        </p>
      )}
      {data.workerPayIncomplete && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          El pago a trabajadores está incompleto: hay trabajos sin nadie asignado o personas sin regla de pago. El resultado real es menor al que se
          muestra. Se revisa en «Pago a trabajadores».
        </p>
      )}
      {!data.companyExpensesAvailable && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Falta correr la migración <code>database/migrations/add_company_expenses.sql</code>: el resultado no incluye gastos de la empresa.
        </p>
      )}

      <Card className="max-w-2xl p-6">
        <Line label="Servicios del período (con IVA)" value={data.grossRevenue} />
        <Line label="IVA de los servicios con boleta o factura" value={data.ivaDebito} indent minus />
        <Line label="Ingresos netos" value={data.netRevenue} strong />

        <Line label="Pago a trabajadores" value={data.workerPay} indent minus hint={data.workerBonuses > 0 ? `Incluye ${clp(data.workerBonuses)} en bonificaciones` : undefined} />
        <Line label="Gastos de terreno aprobados" value={data.fieldExpenses} indent minus hint="Rendidos por los trabajadores, monto total del comprobante" />
        <Line label="Margen después del servicio" value={data.grossMargin} strong />

        {data.companyExpenses.length === 0 ? (
          <Line label="Gastos de la empresa" value={0} indent minus hint="Sin gastos cargados en el período. Se cargan en «Gastos»." />
        ) : (
          data.companyExpenses.map((g) => <Line key={g.category} label={g.label} value={g.net} indent minus />)
        )}
        <Line label="Resultado del período" value={data.result} strong />

        <p className="mt-4 text-xs text-gray-500">
          Resultado de gestión, armado con lo que está en el panel. Los gastos de la empresa van netos del IVA que se les anotó. No incluye
          depreciación, remuneraciones que no pasan por el panel ni impuesto a la renta: no reemplaza el estado de resultados del contador.
        </p>
      </Card>

      {/* El banco se lee por mes calendario: se cruza el mes en que termina el período. */}
      <BankReconciliationCard period={data.to.slice(0, 7)} />
    </div>
  )
}
