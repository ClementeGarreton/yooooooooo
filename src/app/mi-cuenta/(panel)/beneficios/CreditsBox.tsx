'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { WITHDRAWAL_STATUS_LABEL, type CustomerCredits } from '@/lib/referralCreditTypes'
import BankDataBox from '../../BankDataBox'

/**
 * Créditos del cliente: saldo, seguimiento de sus referidos (cotizó → pagó), datos de
 * transferencia (BankDataBox, también en «Mis datos») y el botón de retiro. Sin datos de
 * transferencia no se puede retirar.
 */

const clp = (n: number) => `$${Math.round(n).toLocaleString('es-CL')}`
const day = (iso: string) => new Date(iso).toLocaleDateString('es-CL', { timeZone: 'America/Santiago', day: 'numeric', month: 'short', year: 'numeric' })

export default function CreditsBox({ credits }: { credits: CustomerCredits }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const post = async (url: string, body: unknown, ok: string) => {
    if (busy) return
    setBusy(true)
    setError(null)
    setDone(null)
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'Algo falló. Intenta de nuevo.')
      setDone(ok)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Algo falló. Intenta de nuevo.')
    } finally {
      setBusy(false)
    }
  }

  const canWithdraw = credits.balance > 0 && !!credits.bank && !credits.openWithdrawal

  return (
    <section className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm lg:col-span-2">
      <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500">Tus créditos Yo me encargo</h2>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-4xl font-bold text-slate-900">{credits.balance.toLocaleString('es-CL')}</p>
          <p className="text-sm text-slate-500">1 crédito = $1. Los ganas cuando alguien que usó tu código paga su servicio.</p>
        </div>
        <button
          type="button"
          disabled={!canWithdraw || busy}
          onClick={() => {
            if (window.confirm(`¿Retirar ${clp(credits.balance)}? Te lo transferimos a la cuenta que cargaste.`)) {
              post('/api/cuenta/creditos/retirar', {}, 'Solicitud enviada. Te transferimos a la cuenta que cargaste.')
            }
          }}
          className="rounded-xl bg-brand-green px-5 py-3 font-bold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Retirar mis créditos
        </button>
      </div>
      {credits.openWithdrawal ? (
        <p className="mt-2 text-sm font-semibold text-amber-700">
          Tienes un retiro de {clp(credits.openWithdrawal.amount)} en curso, solicitado el {day(credits.openWithdrawal.requestedAt)}.
        </p>
      ) : !credits.bank ? (
        <p className="mt-2 text-sm font-semibold text-amber-700">Para retirar, primero carga tus datos de transferencia.</p>
      ) : null}
      {error && <p className="mt-2 text-sm font-semibold text-red-600">{error}</p>}
      {done && <p className="mt-2 text-sm font-semibold text-green-700">{done}</p>}

      <div className="mt-6 grid gap-6 border-t border-slate-100 pt-5 lg:grid-cols-2">
        <div>
          <h3 className="text-sm font-bold text-slate-900">Seguimiento de tus referidos</h3>
          {credits.referrals.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">Todavía nadie usó tu código.</p>
          ) : (
            <ul className="mt-2 divide-y divide-slate-100">
              {credits.referrals.map((r) => (
                <li key={r.id} className="py-2.5">
                  <p className="text-sm font-semibold text-slate-900">
                    {r.referredName} <span className="font-normal text-slate-500">· {day(r.quotedAt)}</span>
                  </p>
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                    <span className="rounded-full bg-green-50 px-2 py-0.5 font-bold text-green-700">1 · Usó tu código al cotizar</span>
                    <span className={`rounded-full px-2 py-0.5 font-bold ${r.paid ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                      2 · {r.paid ? 'Pagó su servicio' : 'Falta que pague'}
                    </span>
                    {r.credits > 0 && <span className="font-bold text-slate-900">+{r.credits.toLocaleString('es-CL')} créditos</span>}
                  </p>
                </li>
              ))}
            </ul>
          )}
          {credits.withdrawals.length > 0 && (
            <>
              <h3 className="mt-5 text-sm font-bold text-slate-900">Tus retiros</h3>
              <ul className="mt-2 divide-y divide-slate-100 text-sm">
                {credits.withdrawals.map((w) => (
                  <li key={w.id} className="py-2">
                    {clp(w.amount)} · {day(w.requestedAt)} · <span className="font-semibold">{WITHDRAWAL_STATUS_LABEL[w.status]}</span>
                    {w.status === 'rechazado' && w.note ? <span className="text-slate-500"> — {w.note}</span> : null}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        <BankDataBox bank={credits.bank} />
      </div>
    </section>
  )
}
