'use client'

import { useEffect, useState } from 'react'
import Card from '@/components/ui/Card'
import type { BankReconciliation, ReconciliationSide } from '@/lib/accountingTypes'

/**
 * Cruce del mes entre BancoEstado y el panel, dentro del EERR. Dos bloques: ingresos (abonos
 * del banco contra cobros que no pasaron por Flow) y gastos (cargos del banco contra gastos
 * de la empresa y pagos a trabajadores). Solo muestra diferencias; no registra nada.
 */

const clp = (n: number) => `$${Math.round(n).toLocaleString('es-CL')}`
const day = (d: string) => d.slice(0, 10).split('-').reverse().slice(0, 2).join('-')
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

function Side({
  title,
  side,
  bankLabel,
  panelLabel,
  onlyBankHelp,
  onlyPanelHelp,
  hasBank,
}: {
  title: string
  side: ReconciliationSide
  bankLabel: string
  panelLabel: string
  onlyBankHelp: string
  onlyPanelHelp: string
  hasBank: boolean
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-t border-gray-100 pt-4 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-sm font-bold text-gray-900">{title}</h4>
        <p className="text-xs text-gray-500">
          {bankLabel}: {side.bankCount} por {clp(side.bankTotal)} · {panelLabel}: {side.panelCount} por {clp(side.panelTotal)}
        </p>
      </div>
      <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-lg bg-green-50 px-3 py-2">
          <p className="text-xs text-green-800">Calzan</p>
          <p className="text-lg font-bold text-green-900">{clp(side.matchedTotal)}</p>
          <p className="text-xs text-green-800">{side.matched.length} movimiento{side.matched.length === 1 ? '' : 's'}</p>
        </div>
        <div className={`rounded-lg px-3 py-2 ${side.onlyBank.length > 0 ? 'bg-amber-50' : 'bg-gray-50'}`}>
          <p className="text-xs text-gray-700">Solo en el banco</p>
          <p className="text-lg font-bold text-gray-900">{clp(side.onlyBankTotal)}</p>
          <p className="text-xs text-gray-600">{side.onlyBank.length} · {onlyBankHelp}</p>
        </div>
        <div className={`rounded-lg px-3 py-2 ${hasBank && side.onlyPanel.length > 0 ? 'bg-amber-50' : 'bg-gray-50'}`}>
          <p className="text-xs text-gray-700">Solo en el panel</p>
          <p className="text-lg font-bold text-gray-900">{clp(side.onlyPanelTotal)}</p>
          <p className="text-xs text-gray-600">{side.onlyPanel.length} · {onlyPanelHelp}</p>
        </div>
      </div>
      {side.onlyBank.length + side.onlyPanel.length + side.matched.length > 0 && (
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="mt-2 text-xs font-semibold text-primary-600 hover:underline">
          {open ? 'Ocultar detalle' : 'Ver detalle'}
        </button>
      )}
      {open && (
        <div className="mt-2 grid gap-4 text-sm lg:grid-cols-3">
          <div>
            <p className="mb-1 text-xs font-bold uppercase tracking-wide text-gray-500">Solo en el banco</p>
            {side.onlyBank.length === 0 ? (
              <p className="text-gray-500">Nada.</p>
            ) : (
              <ul className="max-h-64 space-y-1 overflow-auto text-gray-700">
                {side.onlyBank.map((b, i) => (
                  <li key={i}>
                    {day(b.date)} · <span className="font-semibold">{clp(b.amount)}</span> · {b.description || 'sin glosa'}
                    {b.provisional && <span className="text-xs text-gray-500"> (provisorio)</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <p className="mb-1 text-xs font-bold uppercase tracking-wide text-gray-500">Solo en el panel</p>
            {side.onlyPanel.length === 0 ? (
              <p className="text-gray-500">Nada.</p>
            ) : (
              <ul className="max-h-64 space-y-1 overflow-auto text-gray-700">
                {side.onlyPanel.map((p) => (
                  <li key={p.id}>
                    {day(p.date)} · <span className="font-semibold">{clp(p.amount)}</span> · {p.label}
                    {p.detail && <span className="text-xs text-gray-500"> ({p.detail})</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <p className="mb-1 text-xs font-bold uppercase tracking-wide text-gray-500">Calzan</p>
            {side.matched.length === 0 ? (
              <p className="text-gray-500">Nada.</p>
            ) : (
              <ul className="max-h-64 space-y-1 overflow-auto text-gray-700">
                {side.matched.map((m) => (
                  <li key={m.panel.id}>
                    {day(m.bank.date)} · <span className="font-semibold">{clp(m.bank.amount)}</span> · {m.panel.label}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default function BankReconciliationCard({ period }: { period: string }) {
  const [data, setData] = useState<BankReconciliation | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    setData(null)
    setFailed(false)
    fetch(`/api/admin/accounting/reconciliation?mes=${period}`)
      .then(async (res) => {
        const body = await res.json().catch(() => null)
        if (!res.ok || !body) throw new Error()
        if (alive) setData(body)
      })
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
  }, [period])

  const [y, m] = period.split('-').map(Number)
  const monthName = `${MONTHS[m - 1]} de ${y}`

  return (
    <Card className="p-6">
      <h3 className="text-lg font-bold text-gray-900">Cruce con el banco · {monthName}</h3>
      <p className="text-sm text-gray-600">
        La cartola de BancoEstado contra lo registrado en el panel. Calza un movimiento cuando el monto es el mismo y las fechas están a lo más a 4
        días. Es por mes calendario completo.
      </p>

      {failed ? (
        <p className="mt-3 text-sm text-red-600">No se pudo hacer el cruce. Intenta de nuevo.</p>
      ) : !data ? (
        <p className="mt-3 text-sm text-gray-500">Leyendo el banco…</p>
      ) : (
        <>
          {!data.bankConfigured ? (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">El banco no está conectado en el servidor: falta la conexión de BancoEstado en Emisso.</p>
          ) : data.bankError ? (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">El banco respondió con un error: {data.bankError}</p>
          ) : (
            !data.bankHasData && (
              <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                El banco no entregó ningún movimiento de {monthName}, así que no hay con qué cruzar: abajo se ve solo lo que tiene el panel. La
                conexión existe y sincroniza, pero llega vacía; se revisa en Emisso.
              </p>
            )
          )}

          <div className="mt-4 space-y-4">
            <Side
              title="Ingresos: abonos del banco contra cobros del panel"
              side={data.income}
              bankLabel="Abonos"
              panelLabel="Cobros sin Flow"
              onlyBankHelp="plata que entró sin cobro registrado"
              onlyPanelHelp="efectivo, otro mes u otra cuenta"
              hasBank={data.bankHasData}
            />
            <Side
              title="Gastos: cargos del banco contra gastos y pagos a trabajadores"
              side={data.expenses}
              bankLabel="Cargos"
              panelLabel="Gastos y pagos"
              onlyBankHelp="gasto que falta en el EERR"
              onlyPanelHelp="pagado en efectivo o por otra cuenta"
              hasBank={data.bankHasData}
            />
          </div>
          <p className="mt-4 text-xs text-gray-500">
            Los cobros por Flow del mes ({clp(data.flowLedgerTotal)}) no se cruzan uno a uno: Flow los deposita agrupados y descontando su comisión, así
            que sus depósitos aparecen en «Solo en el banco». El cruce de Flow pago por pago está en «IVA y banco». Los gastos que rinden los
            trabajadores tampoco se buscan en el banco: los pagan ellos y se les devuelven en su pago.
          </p>
        </>
      )}
    </Card>
  )
}
