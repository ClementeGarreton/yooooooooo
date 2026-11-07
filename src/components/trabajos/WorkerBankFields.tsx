'use client'

import { BANKS, BANK_ACCOUNT_TYPES } from '@/lib/workerPayTypes'

export interface BankForm {
  bankCode: string
  bankAccountType: string
  bankAccountNumber: string
}

/** Banco, tipo y número de cuenta: los usan el registro y «Mis datos» del trabajador. */
export default function WorkerBankFields({ value, onChange }: { value: BankForm; onChange: (next: BankForm) => void }) {
  const input = 'mt-1 w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base'
  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium text-gray-700">
        Banco
        <select value={value.bankCode} onChange={(e) => onChange({ ...value, bankCode: e.target.value })} className={input}>
          <option value="">Elige tu banco</option>
          {BANKS.map((b) => (
            <option key={b.code} value={String(b.code)}>
              {b.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm font-medium text-gray-700">
        Tipo de cuenta
        <select value={value.bankAccountType} onChange={(e) => onChange({ ...value, bankAccountType: e.target.value })} className={input}>
          <option value="">Elige el tipo</option>
          {BANK_ACCOUNT_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm font-medium text-gray-700">
        Número de cuenta
        <input
          inputMode="numeric"
          value={value.bankAccountNumber}
          onChange={(e) => onChange({ ...value, bankAccountNumber: e.target.value.replace(/\D/g, '').slice(0, 20) })}
          className={input}
        />
      </label>
    </div>
  )
}
