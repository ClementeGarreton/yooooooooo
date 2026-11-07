'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import WorkerBankFields, { type BankForm } from './WorkerBankFields'
import type { WorkerOwnData } from '@/lib/workerSignup'

/** «Mis datos» del trabajador: teléfono, correo y datos bancarios, que puede cambiar él mismo. */
export default function WorkerOwnDataForm({ initial, readOnly }: { initial: WorkerOwnData; readOnly?: boolean }) {
  const router = useRouter()
  const [contact, setContact] = useState({ phone: initial.phone || '', email: initial.email || '' })
  const [bank, setBank] = useState<BankForm>({
    bankCode: initial.bankCode !== null ? String(initial.bankCode) : '',
    bankAccountType: initial.bankAccountType || '',
    bankAccountNumber: initial.bankAccountNumber || '',
  })
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [saving, setSaving] = useState(false)

  const save = async (body: Record<string, unknown>) => {
    if (saving || readOnly) return
    setSaving(true)
    setMessage(null)
    try {
      const res = await fetch('/api/trabajos/mis-datos', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'No pudimos guardar tus datos.')
      setMessage({ ok: true, text: 'Datos guardados.' })
      router.refresh()
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : 'No pudimos guardar tus datos.' })
    } finally {
      setSaving(false)
    }
  }

  const input = 'mt-1 w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base'
  const button = 'w-full rounded-lg bg-[#2C5282] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60'
  return (
    <div className="space-y-5">
      <div className="rounded-xl bg-white p-4 shadow-sm">
        <p className="text-sm text-slate-500">Nombre y RUT (los corrige la oficina)</p>
        <p className="font-semibold text-slate-900">
          {initial.name} · {initial.rut}
        </p>
      </div>

      <div className="space-y-3 rounded-xl bg-white p-4 shadow-sm">
        <p className="font-semibold text-slate-900">Contacto</p>
        <label className="block text-sm font-medium text-gray-700">
          Teléfono
          <input type="tel" value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} className={input} />
        </label>
        <label className="block text-sm font-medium text-gray-700">
          Correo
          <input type="email" value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} className={input} />
        </label>
        <button type="button" disabled={saving || readOnly} onClick={() => save(contact)} className={button}>
          Guardar contacto
        </button>
      </div>

      <div className="space-y-3 rounded-xl bg-white p-4 shadow-sm">
        <p className="font-semibold text-slate-900">Datos bancarios</p>
        {initial.bankAvailable ? (
          <>
            <WorkerBankFields value={bank} onChange={setBank} />
            <button type="button" disabled={saving || readOnly} onClick={() => save({ ...bank })} className={button}>
              Guardar datos bancarios
            </button>
            <p className="text-xs text-slate-500">A esta cuenta se te transfieren los pagos. La oficina ve cada cambio.</p>
          </>
        ) : (
          <p className="text-sm text-slate-500">Todavía no se pueden cargar datos bancarios aquí.</p>
        )}
      </div>

      {message && <p className={`text-center text-sm ${message.ok ? 'text-green-700' : 'text-red-700'}`}>{message.text}</p>}
    </div>
  )
}
