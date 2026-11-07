'use client'

import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import Card from '@/components/ui/Card'
import type { BankMonth, FlowMonth, IvaLine, IvaMonth } from '@/lib/accountingTypes'

/**
 * Contabilidad del mes con datos del SII y del banco (leídos por Emisso, solo lectura).
 *  - IVA: débito de lo vendido menos crédito de lo comprado, según el Registro de Compras y
 *    Ventas. Es por mes porque así se declara (F29).
 *  - Banco: movimientos y saldo de la cuenta, cuando la conexión está configurada y
 *    sincronizada.
 */

const clp = (n: number) => `$${Math.round(n).toLocaleString('es-CL')}`
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const currentMonth = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date()).slice(0, 7)
const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('es-CL', { timeZone: 'America/Santiago', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'

function Line({ label, line, sign = 1, muted }: { label: string; line: IvaLine; sign?: 1 | -1; muted?: boolean }) {
  return (
    <tr className={muted ? 'text-gray-400' : undefined}>
      <td className="px-5 py-2">{label}</td>
      <td className="px-5 py-2 text-right">{line.count}</td>
      <td className="px-5 py-2 text-right">{clp(line.net)}</td>
      <td className="px-5 py-2 text-right font-medium">
        {sign < 0 && line.iva > 0 ? '−' : ''}
        {clp(line.iva)}
      </td>
    </tr>
  )
}

export default function AccountingPanel() {
  const [month, setMonth] = useState(currentMonth())
  const [iva, setIva] = useState<IvaMonth | null>(null)
  const [bank, setBank] = useState<BankMonth | null>(null)
  const [flow, setFlow] = useState<FlowMonth | null>(null)

  const load = useCallback(async (mes: string) => {
    setIva(null)
    setBank(null)
    setFlow(null)
    const get = async (url: string) => {
      const res = await fetch(url)
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || 'No se pudo cargar')
      return body
    }
    get(`/api/admin/accounting/iva?mes=${mes}`).then(setIva).catch((e) => toast.error(e.message))
    get(`/api/admin/accounting/bank?mes=${mes}`).then(setBank).catch((e) => toast.error(e.message))
    get(`/api/admin/accounting/flow?mes=${mes}`).then(setFlow).catch((e) => toast.error(e.message))
  }, [])

  useEffect(() => {
    load(month)
  }, [load, month])

  const [y, m] = month.split('-').map(Number)
  const monthName = `${MONTHS[m - 1]} de ${y}`

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-gray-600">
          IVA y banco de {monthName}. Los datos vienen del SII y del banco; acá no se declara ni se paga nada.
        </p>
        <input
          type="month"
          value={month}
          max={currentMonth()}
          onChange={(e) => e.target.value && setMonth(e.target.value)}
          aria-label="Mes"
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
        />
      </div>

      {/* ───────────── IVA ───────────── */}
      {!iva ? (
        <Card className="p-6 text-sm text-gray-500">Leyendo el Registro de Compras y Ventas del SII…</Card>
      ) : !iva.configured ? (
        <Card className="p-6">
          <h3 className="text-lg font-bold text-gray-900">IVA del mes</h3>
          <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Falta configurar Emisso en el servidor: <code>EMISSO_CONNECT_API_KEY</code> y <code>EMISSO_CONNECTION_ID</code> (la
            conexión del SII de la empresa).
          </p>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Card className="border-l-4 border-l-amber-500 p-4">
              <p className="text-sm text-gray-500">IVA débito (ventas)</p>
              <p className="text-2xl font-bold text-gray-900">{clp(iva.debit)}</p>
              <p className="text-xs text-gray-500">Facturas y boletas emitidas</p>
            </Card>
            <Card className="border-l-4 border-l-green-500 p-4">
              <p className="text-sm text-gray-500">IVA crédito (compras)</p>
              <p className="text-2xl font-bold text-gray-900">{clp(iva.credit)}</p>
              <p className="text-xs text-gray-500">Facturas recibidas y registradas</p>
            </Card>
            <Card className={`border-l-4 p-4 ${iva.result > 0 ? 'border-l-red-500' : 'border-l-blue-500'}`}>
              <p className="text-sm text-gray-500">{iva.result > 0 ? 'IVA a pagar (estimado)' : 'Remanente a favor (estimado)'}</p>
              <p className="text-2xl font-bold text-gray-900">{clp(Math.abs(iva.result))}</p>
              <p className="text-xs text-gray-500">Débito − crédito del mes</p>
            </Card>
          </div>

          {iva.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">Emisso respondió un error: {iva.error}</p>}
          <p className="text-xs text-gray-500">
            Sincronizado con el SII el {when(iva.syncedAt)}
            {iva.complete ? '' : ' · OJO: el mes no está leído completo, las cifras pueden subir'}. Es una estimación: el F29 real
            además considera el remanente de meses anteriores, PPM, retenciones y compras sin derecho a crédito.
          </p>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="overflow-hidden p-0">
              <h3 className="border-b border-gray-100 px-5 py-3 font-bold text-gray-900">Ventas (débito)</h3>
              <table className="min-w-full divide-y divide-gray-100 text-sm">
                <thead className="bg-gray-50 text-xs uppercase tracking-wider text-gray-500">
                  <tr>
                    <th className="px-5 py-2 text-left">Documento</th>
                    <th className="px-5 py-2 text-right">Cant.</th>
                    <th className="px-5 py-2 text-right">Neto</th>
                    <th className="px-5 py-2 text-right">IVA</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white text-gray-800">
                  <Line label="Facturas emitidas" line={iva.sales.invoices} />
                  <Line label="Boletas" line={iva.sales.receipts} />
                  <Line label="Notas de débito" line={iva.sales.debitNotes} />
                  <Line label="Notas de crédito" line={iva.sales.creditNotes} sign={-1} />
                  <Line label="Pagos con tarjeta (no se suman)" line={iva.sales.cardVouchers} muted />
                </tbody>
              </table>
              <p className="border-t border-gray-100 px-5 py-2 text-xs text-gray-500">
                Los pagos con tarjeta son informativos: pueden repetir ventas que ya tienen boleta o factura.
              </p>
            </Card>

            <Card className="overflow-hidden p-0">
              <h3 className="border-b border-gray-100 px-5 py-3 font-bold text-gray-900">Compras (crédito)</h3>
              <table className="min-w-full divide-y divide-gray-100 text-sm">
                <thead className="bg-gray-50 text-xs uppercase tracking-wider text-gray-500">
                  <tr>
                    <th className="px-5 py-2 text-left">Documento</th>
                    <th className="px-5 py-2 text-right">Cant.</th>
                    <th className="px-5 py-2 text-right">Neto</th>
                    <th className="px-5 py-2 text-right">IVA</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white text-gray-800">
                  <Line label="Facturas recibidas" line={iva.purchases.invoices} />
                  <Line label="Notas de débito" line={iva.purchases.debitNotes} />
                  <Line label="Notas de crédito" line={iva.purchases.creditNotes} sign={-1} />
                  <Line label="Facturas exentas" line={iva.purchases.exempt} />
                  <Line label="Pendientes en el SII (aún sin crédito)" line={iva.purchases.pending} muted />
                </tbody>
              </table>
              {iva.purchases.pending.iva > 0 && (
                <p className="border-t border-gray-100 px-5 py-2 text-xs text-amber-700">
                  Hay {clp(iva.purchases.pending.iva)} de IVA en compras que el SII todavía tiene pendientes: si se aceptan, el
                  crédito sube en ese monto.
                </p>
              )}
            </Card>
          </div>
        </>
      )}

      {/* ───────────── Flow ───────────── */}
      <Card className="p-5">
        <h3 className="text-lg font-bold text-gray-900">Flow</h3>
        <p className="text-sm text-gray-600">Lo que Flow dice que se pagó en {monthName}, contra los cobros registrados en el panel.</p>
        {!flow ? (
          <p className="mt-3 text-sm text-gray-500">Consultando Flow día por día…</p>
        ) : !flow.configured ? (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">Flow no está configurado en el servidor.</p>
        ) : flow.error ? (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">Flow respondió un error: {flow.error}</p>
        ) : (
          <>
            <div className="mt-3 grid grid-cols-2 gap-4 lg:grid-cols-4">
              <div>
                <p className="text-xs text-gray-500">Pagado en Flow</p>
                <p className="text-xl font-bold text-gray-900">{clp(flow.total)}</p>
                <p className="text-xs text-gray-500">{flow.count} pagos</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Comisión de Flow</p>
                <p className="text-xl font-bold text-gray-900">{clp(flow.fees)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Neto a depositar</p>
                <p className="text-xl font-bold text-gray-900">{clp(flow.net)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Registrado en el panel</p>
                <p className={`text-xl font-bold ${flow.ledgerTotal === flow.total ? 'text-green-700' : 'text-orange-700'}`}>{clp(flow.ledgerTotal)}</p>
                <p className="text-xs text-gray-500">{flow.ledgerCount} cobros</p>
              </div>
            </div>
            {flow.missingInPanel.length === 0 && flow.missingInFlow.length === 0 ? (
              <p className="mt-3 text-sm font-semibold text-green-700">Flow y el panel coinciden pago por pago.</p>
            ) : (
              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                {flow.missingInPanel.length > 0 && (
                  <div>
                    <p className="text-sm font-semibold text-orange-700">Pagados en Flow que el panel no registra ({flow.missingInPanel.length})</p>
                    <ul className="mt-1 max-h-48 space-y-1 overflow-auto text-sm text-gray-700">
                      {flow.missingInPanel.map((p) => (
                        <li key={p.flowOrder}>
                          {p.date.split('-').reverse().join('-')} · orden {p.flowOrder} · {p.commerceOrder} · {clp(p.amount)}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {flow.missingInFlow.length > 0 && (
                  <div>
                    <p className="text-sm font-semibold text-orange-700">En el panel como Flow, sin pago en Flow este mes ({flow.missingInFlow.length})</p>
                    <ul className="mt-1 max-h-48 space-y-1 overflow-auto text-sm text-gray-700">
                      {flow.missingInFlow.map((p, i) => (
                        <li key={i}>
                          {p.date.split('-').reverse().join('-')} · {p.quoteId} · {clp(p.amount)}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </Card>

      {/* ───────────── Banco ───────────── */}
      <Card className="overflow-hidden p-0">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-gray-100 px-5 py-4">
          <div>
            <h3 className="text-lg font-bold text-gray-900">Banco</h3>
            <p className="text-sm text-gray-600">Movimientos de la cuenta en {monthName}.</p>
          </div>
          {bank?.configured && bank.movements.length > 0 && (
            <p className="text-sm text-gray-700">
              Abonos <span className="font-bold text-green-700">{clp(bank.credits)}</span> · Cargos{' '}
              <span className="font-bold text-red-700">{clp(bank.debits)}</span>
              {bank.balances.map((b) => (
                <span key={b.account}> · Saldo {b.account ? `…${b.account.slice(-4)}` : ''} <span className="font-bold">{clp(b.balance)}</span></span>
              ))}
            </p>
          )}
        </div>
        {!bank ? (
          <p className="p-5 text-sm text-gray-500">Leyendo el banco…</p>
        ) : !bank.configured ? (
          <p className="m-5 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Falta configurar la conexión del banco en el servidor: <code>EMISSO_BANK_CONNECTION_ID</code>.
          </p>
        ) : bank.error ? (
          <p className="m-5 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">Emisso respondió un error: {bank.error}</p>
        ) : bank.movements.length === 0 ? (
          <p className="p-5 text-sm text-gray-500">
            La conexión del banco no tiene movimientos sincronizados para este mes. Hay que sincronizarla desde Emisso antes de
            poder verlos acá.
          </p>
        ) : (
          <div className="max-h-[28rem] overflow-auto">
            <table className="min-w-full divide-y divide-gray-100 text-sm">
              <thead className="sticky top-0 bg-gray-50 text-xs uppercase tracking-wider text-gray-500">
                <tr>
                  <th className="px-5 py-2 text-left">Fecha</th>
                  <th className="px-5 py-2 text-left">Detalle</th>
                  <th className="px-5 py-2 text-right">Abono</th>
                  <th className="px-5 py-2 text-right">Cargo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {bank.movements.map((mv, i) => (
                  <tr key={i} className={mv.provisional ? 'text-gray-400' : 'text-gray-800'}>
                    <td className="whitespace-nowrap px-5 py-2">{mv.date.split('-').reverse().join('-')}</td>
                    <td className="px-5 py-2">
                      {mv.description}
                      {mv.provisional ? ' (provisorio)' : ''}
                    </td>
                    <td className="whitespace-nowrap px-5 py-2 text-right text-green-700">{mv.kind === 'abono' ? clp(mv.amount) : ''}</td>
                    <td className="whitespace-nowrap px-5 py-2 text-right text-red-700">{mv.kind === 'cargo' ? clp(mv.amount) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
