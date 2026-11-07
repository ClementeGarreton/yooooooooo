// Tipos de los créditos por referidos, SIN dependencias de servidor.

export const ACCOUNT_TYPES = ['Cuenta corriente', 'Cuenta vista', 'Cuenta RUT', 'Cuenta de ahorro'] as const

export interface BankData {
  holderName: string
  holderRut: string
  bankName: string
  accountType: string
  accountNumber: string
  email: string | null
}

export type WithdrawalStatus = 'solicitado' | 'pagado' | 'rechazado'

export const WITHDRAWAL_STATUS_LABEL: Record<WithdrawalStatus, string> = {
  solicitado: 'Solicitado',
  pagado: 'Transferido',
  rechazado: 'Rechazado',
}

/** Un uso del código de referido, con sus dos pasos. */
export interface ReferralStep {
  id: string
  /** Solo el primer nombre: quien refiere no necesita más datos del referido. */
  referredName: string
  /** Paso 1: usó el código en una cotización. */
  quotedAt: string
  /** Paso 2: pagó la reserva de esa cotización. */
  paid: boolean
  /** Créditos ya entregados por este referido (0 si todavía no). */
  credits: number
}

export interface CustomerCredits {
  /** false = falta correr add_referral_credits.sql. */
  available: boolean
  balance: number
  referrals: ReferralStep[]
  movements: { id: string; amount: number; kind: string; note: string | null; createdAt: string }[]
  bank: BankData | null
  openWithdrawal: { id: string; amount: number; requestedAt: string } | null
  withdrawals: { id: string; amount: number; status: WithdrawalStatus; requestedAt: string; note: string | null }[]
}

export interface AdminWithdrawal {
  id: string
  customerLabel: string
  customerEmail: string
  amount: number
  status: WithdrawalStatus
  bank: BankData
  requestedAt: string
  resolvedAt: string | null
  resolvedBy: string | null
  note: string | null
}

export interface AdminReferral extends ReferralStep {
  ownerLabel: string
  code: string
  quoteId: string
}

export interface AdminCreditsData {
  available: boolean
  withdrawals: AdminWithdrawal[]
  referrals: AdminReferral[]
  /** Créditos en saldos de clientes, sin contar lo ya solicitado: lo que se debe. */
  outstanding: number
}
