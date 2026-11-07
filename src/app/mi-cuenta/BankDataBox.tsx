'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ACCOUNT_TYPES, type BankData } from '@/lib/referralCreditTypes'

/**
 * Datos de transferencia del cliente (la cuenta a la que se le transfieren sus créditos).
 * Se ven y se cambian en «Beneficios» y en «Mis datos»: es el mismo dato y la misma API.
 */

const field = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-brand-blue-dark focus:outline-none'

export default function BankDataBox({ bank }: { bank: BankData | null }) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({
    holderName: bank?.holderName || '',
    holderRut: bank?.holderRut || '',
    bankName: bank?.bankName || '',
    accountType: bank?.accountType || ACCOUNT_TYPES[0],
    accountNumber: bank?.accountNumber || '',
    email: bank?.email || '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const save = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    setDone(null)
    try {
      const res = await fetch('/api/cuenta/creditos/datos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'Algo falló. Intenta de nuevo.')
      setDone('Datos guardados.')
      setEditing(false)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Algo falló. Intenta de nuevo.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-slate-900">Datos de transferencia</h3>
        {bank && !editing && (
          <button type="button" onClick={() => setEditing(true)} className="text-sm font-bold text-brand-blue-dark hover:underline">
            Editar
          </button>
        )}
      </div>
      {bank && !editing ? (
        <dl className="mt-2 space-y-1 text-sm text-slate-700">
          <div>{bank.holderName} · RUT {bank.holderRut}</div>
          <div>{bank.bankName} · {bank.accountType}</div>
          <div>N° {bank.accountNumber}</div>
          {bank.email && <div>{bank.email}</div>}
        </dl>
      ) : (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <input className={field} placeholder="Nombre del titular" value={form.holderName} onChange={(e) => setForm({ ...form, holderName: e.target.value })} />
          <input className={field} placeholder="RUT del titular" value={form.holderRut} onChange={(e) => setForm({ ...form, holderRut: e.target.value })} />
          <input className={field} placeholder="Banco" value={form.bankName} onChange={(e) => setForm({ ...form, bankName: e.target.value })} />
          <select className={field} value={form.accountType} onChange={(e) => setForm({ ...form, accountType: e.target.value })}>
            {ACCOUNT_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
          <input className={field} inputMode="numeric" placeholder="Número de cuenta" value={form.accountNumber} onChange={(e) => setForm({ ...form, accountNumber: e.target.value })} />
          <input className={field} type="email" placeholder="Correo para el comprobante (opcional)" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <div className="flex items-center gap-3 sm:col-span-2">
            <button type="button" disabled={busy} onClick={save} className="rounded-xl bg-brand-blue-dark px-4 py-2 text-sm font-bold text-white hover:opacity-90 disabled:opacity-60">
              Guardar datos
            </button>
            {editing && (
              <button type="button" onClick={() => setEditing(false)} className="text-sm text-slate-500">
                Cancelar
              </button>
            )}
          </div>
        </div>
      )}
      {error && <p className="mt-2 text-sm font-semibold text-red-600">{error}</p>}
      {done && <p className="mt-2 text-sm font-semibold text-green-700">{done}</p>}
    </div>
  )
}
