'use client'

import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import { formatRut } from '@/lib/rut'
import { WITHDRAWAL_STATUS_LABEL, type AdminCreditsData, type AdminWithdrawal } from '@/lib/referralCreditTypes'

/**
 * Créditos por referidos, dentro de Marketing: los retiros que piden los clientes (con sus
 * datos de transferencia, para pagar y marcar como transferido) y el seguimiento de cada
 * referido en sus dos pasos: usó el código al cotizar → pagó.
 */

const clp = (n: number) => `$${Math.round(n).toLocaleString('es-CL')}`
const when = (iso: string) =>
  new Date(iso).toLocaleString('es-CL', { timeZone: 'America/Santiago', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

export default function ReferralCredits() {
  const [data, setData] = useState<AdminCreditsData | null>(null)
  const [rejectingId, setRejectingId] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/credits')
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || 'No se pudieron cargar los créditos')
      setData(body)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudieron cargar los créditos')
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const resolve = async (w: AdminWithdrawal, decision: 'pagado' | 'rechazado') => {
    if (busy) return
    if (decision === 'pagado' && !window.confirm(`¿Confirmas que ya transferiste ${clp(w.amount)} a ${w.bank.holderName}?`)) return
    if (decision === 'rechazado' && !note.trim()) {
      toast.error('Escribe el motivo del rechazo')
      return
    }
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/credits/withdrawals/${w.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, note: decision === 'rechazado' ? note : null }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || 'No se pudo guardar')
      toast.success(decision === 'pagado' ? 'Retiro marcado como transferido' : 'Retiro rechazado: créditos devueltos')
      setRejectingId(null)
      setNote('')
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo guardar')
    } finally {
      setBusy(false)
    }
  }

  if (!data) return null
  if (!data.available) {
    return (
      <Card className="p-5">
        <h3 className="text-lg font-bold text-gray-900">Créditos por referidos</h3>
        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Falta correr la migración <code>database/migrations/add_referral_credits.sql</code>. Mientras tanto, los referidos
          siguen premiando con un cupón.
        </p>
      </Card>
    )
  }

  const open = data.withdrawals.filter((w) => w.status === 'solicitado')
  const closed = data.withdrawals.filter((w) => w.status !== 'solicitado')

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-gray-900">Retiros de créditos</h3>
            <p className="text-sm text-gray-600">
              1 crédito = $1. Transfiere al cliente con estos datos y marca el retiro como transferido.
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-500">Créditos en saldos de clientes (sin retirar)</p>
            <p className="text-xl font-bold text-gray-900">{clp(data.outstanding)}</p>
          </div>
        </div>
        {open.length === 0 ? (
          <p className="mt-3 text-sm text-gray-500">No hay retiros esperando.</p>
        ) : (
          <ul className="mt-3 divide-y divide-gray-100">
            {open.map((w) => (
              <li key={w.id} className="py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="text-sm">
                    <p className="font-semibold text-gray-900">
                      {clp(w.amount)} · {w.customerLabel}
                    </p>
                    <p className="text-gray-700">
                      {w.bank.holderName} · RUT {formatRut(w.bank.holderRut)} · {w.bank.bankName} · {w.bank.accountType} · N° {w.bank.accountNumber}
                      {w.bank.email ? ` · ${w.bank.email}` : ''}
                    </p>
                    <p className="text-xs text-gray-500">Solicitado el {when(w.requestedAt)} · {w.customerEmail}</p>
                  </div>
                  {rejectingId !== w.id && (
                    <div className="flex gap-2">
                      <Button size="sm" disabled={busy} onClick={() => resolve(w, 'pagado')}>
                        Marcar transferido
                      </Button>
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => { setRejectingId(w.id); setNote('') }}>
                        Rechazar
                      </Button>
                    </div>
                  )}
                </div>
                {rejectingId === w.id && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <input
                      autoFocus
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      maxLength={500}
                      placeholder="Motivo del rechazo (lo lee el cliente); los créditos vuelven a su saldo"
                      className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
                    />
                    <Button size="sm" disabled={busy} onClick={() => resolve(w, 'rechazado')}>
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
        {closed.length > 0 && (
          <div className="mt-4 border-t border-gray-100 pt-3">
            <p className="mb-1 text-xs font-bold uppercase tracking-wide text-gray-500">Retiros resueltos</p>
            <ul className="divide-y divide-gray-100 text-sm">
              {closed.map((w) => (
                <li key={w.id} className="py-2 text-gray-700">
                  {clp(w.amount)} · {w.customerLabel} · <span className="font-semibold">{WITHDRAWAL_STATUS_LABEL[w.status]}</span>
                  <span className="text-xs text-gray-500">
                    {' '}
                    {[w.resolvedBy, w.resolvedAt ? when(w.resolvedAt) : null, w.note].filter(Boolean).join(' · ')}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      <Card className="overflow-hidden p-0">
        <div className="border-b border-gray-100 px-5 py-4">
          <h3 className="text-lg font-bold text-gray-900">Seguimiento de referidos</h3>
          <p className="text-sm text-gray-600">Cada uso de un código: primero se usó para cotizar, después se pagó. Los créditos se entregan en el segundo paso.</p>
        </div>
        {data.referrals.length === 0 ? (
          <p className="p-5 text-sm text-gray-500">Todavía nadie usó un código de referido.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-100 text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wider text-gray-500">
                <tr>
                  <th className="px-5 py-2 text-left">Quién refirió</th>
                  <th className="px-5 py-2 text-left">Código</th>
                  <th className="px-5 py-2 text-left">Referido</th>
                  <th className="px-5 py-2 text-left">1 · Cotizó</th>
                  <th className="px-5 py-2 text-left">2 · Pagó</th>
                  <th className="px-5 py-2 text-right">Créditos</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {data.referrals.map((r) => (
                  <tr key={r.id}>
                    <td className="px-5 py-2 text-gray-800">{r.ownerLabel}</td>
                    <td className="px-5 py-2 font-mono text-gray-700">{r.code}</td>
                    <td className="px-5 py-2 text-gray-700">{r.referredName} · {r.quoteId}</td>
                    <td className="px-5 py-2 text-green-700">{when(r.quotedAt)}</td>
                    <td className={`px-5 py-2 ${r.paid ? 'text-green-700' : 'text-gray-400'}`}>{r.paid ? 'Sí' : 'Pendiente'}</td>
                    <td className="px-5 py-2 text-right font-semibold text-gray-900">{r.credits > 0 ? r.credits.toLocaleString('es-CL') : '—'}</td>
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
