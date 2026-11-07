'use client'

import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import Card from '@/components/ui/Card'
import type { MonthlyIncomeStatement as MonthlyData, MonthlyStatement } from '@/lib/incomeStatementTypes'

/**
 * Estado de resultados mes a mes: un mes por columna, para ver cómo se mueven los márgenes.
 * Ingresos netos, lo que cuesta hacer el servicio (pago a trabajadores y gastos que ellos
 * rinden), el margen que queda, los otros gastos por categoría y el resultado. Abajo, el IVA
 * de cada mes según el SII.
 */

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const monthLabel = (period: string) => {
  const [y, m] = period.split('-').map(Number)
  return `${MONTHS[m - 1]} ${String(y).slice(2)}`
}
const clp = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(Math.round(n)).toLocaleString('es-CL')}`
const pct = (n: number | null) => (n === null ? '—' : `${n.toLocaleString('es-CL')} %`)

type Cell = (m: MonthlyStatement) => string

function Row({
  label,
  hint,
  months,
  cell,
  strong,
  indent,
  tone,
}: {
  label: string
  hint?: string
  months: MonthlyStatement[]
  cell: Cell
  strong?: boolean
  indent?: boolean
  tone?: (m: MonthlyStatement) => string
}) {
  return (
    <tr className={strong ? 'border-t border-gray-200 bg-gray-50/70' : ''}>
      <th scope="row" className={`sticky left-0 z-10 whitespace-nowrap px-4 py-2 text-left text-sm ${strong ? 'bg-gray-50 font-bold text-gray-900' : 'bg-white font-normal text-gray-700'} ${indent ? 'pl-8' : ''}`}>
        {label}
        {hint && <span className="block text-xs font-normal text-gray-500">{hint}</span>}
      </th>
      {months.map((m) => (
        <td key={m.period} className={`whitespace-nowrap px-4 py-2 text-right text-sm tabular-nums ${strong ? 'font-bold text-gray-900' : 'text-gray-700'} ${tone ? tone(m) : ''}`}>
          {cell(m)}
        </td>
      ))}
    </tr>
  )
}

function Section({ title, span }: { title: string; span: number }) {
  return (
    <tr>
      <th colSpan={span} scope="colgroup" className="sticky left-0 bg-white px-4 pb-1 pt-4 text-left text-xs font-bold uppercase tracking-wide text-gray-500">
        {title}
      </th>
    </tr>
  )
}

export default function MonthlyIncomeStatement() {
  const [count, setCount] = useState(6)
  const [data, setData] = useState<MonthlyData | null>(null)

  useEffect(() => {
    let alive = true
    setData(null)
    fetch(`/api/admin/accounting/income-statement?meses=${count}`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(body?.error || 'No se pudo calcular')
        if (alive) setData(body)
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : 'No se pudo calcular'))
    return () => {
      alive = false
    }
  }, [count])

  const months = data?.months || []
  const span = months.length + 1
  const minus = (n: number) => (n === 0 ? clp(0) : `−${clp(n)}`)
  const red = (value: (m: MonthlyStatement) => number) => (m: MonthlyStatement) => (value(m) < 0 ? 'text-red-700' : '')
  const incomplete = months.filter((m) => m.statement.workerPayIncomplete && m.statement.services > 0)
  const noSii = months.filter((m) => m.ivaSource === 'panel')

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-gray-600">Estado de resultados mes a mes, por fecha del servicio. Los montos de ingresos y márgenes van sin IVA.</p>
        <div className="flex gap-1 rounded-xl bg-gray-100 p-1 text-sm">
          {[3, 6, 12].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setCount(n)}
              aria-pressed={count === n}
              className={`rounded-lg px-3 py-1.5 font-semibold ${count === n ? 'bg-white text-primary-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
            >
              {n} meses
            </button>
          ))}
        </div>
      </div>

      {!data ? (
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary-600" />
        </div>
      ) : (
        <>
          {incomplete.length > 0 && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
              El pago a trabajadores está incompleto en {incomplete.map((m) => monthLabel(m.period)).join(', ')}: hay trabajos sin nadie asignado o personas
              sin tarifa de pago. En esos meses el margen real es menor al que se muestra.
            </p>
          )}

          <Card className="overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th scope="col" className="sticky left-0 z-10 bg-white px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-gray-500">
                      Concepto
                    </th>
                    {months.map((m) => (
                      <th key={m.period} scope="col" className="whitespace-nowrap px-4 py-3 text-right text-sm font-bold text-gray-900">
                        {monthLabel(m.period)}
                        {m.inProgress && <span className="block text-xs font-normal text-gray-500">en curso</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  <Section title="Ingresos" span={span} />
                  <Row label="Servicios realizados" months={months} cell={(m) => String(m.statement.services)} />
                  <Row label="Ventas con IVA" months={months} cell={(m) => clp(m.statement.grossRevenue)} />
                  <Row label="IVA de las ventas" indent months={months} cell={(m) => minus(m.statement.ivaDebito)} />
                  <Row label="Ingresos netos" strong months={months} cell={(m) => clp(m.statement.netRevenue)} />

                  <Section title="Costo de hacer el servicio" span={span} />
                  <Row label="Pago a trabajadores" indent months={months} cell={(m) => minus(m.statement.workerPay)} />
                  <Row label="Gastos de trabajadores" hint="Rendidos y aprobados" indent months={months} cell={(m) => minus(m.statement.fieldExpenses)} />
                  <Row label="Margen del servicio" strong months={months} cell={(m) => clp(m.statement.grossMargin)} tone={red((m) => m.statement.grossMargin)} />
                  <Row label="% sobre ingresos netos" indent months={months} cell={(m) => pct(m.serviceMargin)} />

                  <Section title="Otros gastos" span={span} />
                  {data.categories.length === 0 ? (
                    <Row label="Sin gastos cargados" hint="Se cargan en «Gastos»" indent months={months} cell={() => clp(0)} />
                  ) : (
                    data.categories.map((c) => (
                      <Row
                        key={c.category}
                        label={c.label}
                        indent
                        months={months}
                        cell={(m) => minus(m.statement.companyExpenses.find((e) => e.category === c.category)?.net || 0)}
                      />
                    ))
                  )}
                  <Row label="Total otros gastos" months={months} cell={(m) => minus(m.statement.companyExpensesTotal)} />

                  <Section title="Resultado" span={span} />
                  <Row label="Resultado del mes" strong months={months} cell={(m) => clp(m.statement.result)} tone={red((m) => m.statement.result)} />
                  <Row label="Rentabilidad" hint="Resultado sobre ingresos netos" indent months={months} cell={(m) => pct(m.statement.margin)} />

                  <Section title="IVA del mes según el SII" span={span} />
                  <Row label="IVA débito (ventas)" indent months={months} cell={(m) => (m.sii ? clp(m.sii.debit) : '—')} />
                  <Row label="IVA crédito (compras)" indent months={months} cell={(m) => (m.sii ? minus(m.sii.credit) : '—')} />
                  <Row
                    label="IVA a pagar"
                    hint="Negativo = remanente a favor"
                    strong
                    months={months}
                    cell={(m) => (m.sii ? clp(m.sii.result) : '—')}
                  />
                </tbody>
              </table>
            </div>
          </Card>

          <div className="space-y-1 text-xs text-gray-500">
            <p>
              Resultado de gestión, armado con lo que está en el panel: no incluye depreciación, sueldos que no pasen por el panel ni impuesto a la renta, y no
              reemplaza el estado de resultados del contador. Los otros gastos van netos del IVA que se les anotó.
            </p>
            <p>
              El IVA que se descuenta de las ventas es el débito que registra el SII para ese mes. Las ventas van por fecha del servicio y el IVA del SII por
              fecha de emisión del documento, así que un mes puede no calzar exacto con el otro.
              {noSii.length > 0 &&
                ` En ${noSii.map((m) => monthLabel(m.period)).join(', ')} el SII no entregó datos y se usó el IVA de las reservas con boleta o factura marcada, que suele ser menor al real.`}
            </p>
            <p>El mes en curso cuenta como venta todo lo agendado del mes, pero el pago a trabajadores solo de los trabajos ya hechos.</p>
          </div>
        </>
      )}
    </div>
  )
}
