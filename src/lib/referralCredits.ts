/**
 * Créditos Yo me encargo por referidos (add_referral_credits.sql). 1 crédito = 1 CLP.
 *
 * El referido tiene dos pasos:
 *   1) alguien usa el código en una cotización  → fila en `coupon_redemptions`
 *   2) esa cotización se reserva y se PAGA      → recién ahí el dueño del código gana créditos
 * El monto sale de la configuración de referidos (Marketing): un monto fijo, o un porcentaje
 * del valor pagado por el referido.
 *
 * El cliente retira sus créditos con un botón: necesita tener cargados sus datos de
 * transferencia, se le descuenta el saldo y a Yo me encargo le llega un correo. Quien
 * transfiere marca el retiro como pagado en el panel; si lo rechaza, los créditos vuelven.
 *
 * No hay proceso de fondo: los créditos se entregan cuando alguien mira (el cliente abre
 * Beneficios, o el admin abre Marketing).
 */

import { supabaseAdmin } from '@/lib/supabase'
import { isValidRut, normalizeRut, formatRut } from '@/lib/rut'
import { isValidEmail } from '@/lib/emailFormat'
import { sendSystemEmail } from '@/lib/emailTransport'
import { resendConfigured } from '@/lib/resendClient'
import { siteBaseUrl } from '@/lib/fileLinks'
import { ACCOUNT_TYPES } from '@/lib/referralCreditTypes'
import type {
  AdminCreditsData,
  AdminReferral,
  AdminWithdrawal,
  BankData,
  CustomerCredits,
  ReferralStep,
  WithdrawalStatus,
} from '@/lib/referralCreditTypes'
import type { MarketingConfig } from '@/lib/couponTypes'
import { RECOMMENDER_PREFIX, getRecommenderReward } from '@/lib/recommenderReward'

export class CreditError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message)
    this.name = 'CreditError'
  }
}

/** ¿Están las tablas? Si no, los referidos siguen con cupón de premio. */
export async function creditsAvailable(): Promise<boolean> {
  const { error } = await supabaseAdmin.from('customer_credit_movements').select('id').limit(1)
  return !error
}

/** Créditos que da un referido validado. */
export function creditsFor(config: MarketingConfig, amountPaidByReferred: number): number {
  // Como en AppleFix: floor(monto pagado / pesos por token). Acá cada token vale $1.
  if (config.pesosPerToken) return Math.floor(amountPaidByReferred / config.pesosPerToken)
  if (!config.rewardKind || !config.rewardValue) return 0
  return config.rewardKind === 'monto' ? config.rewardValue : Math.round((amountPaidByReferred * config.rewardValue) / 100)
}

interface Redemption {
  id: string
  coupon_id: string
  customer_id: string
  quote_id: string
  amount_after: number
  created_at: string
}

/**
 * Paso 2 de cada uso: ¿la reserva de esa cotización existe, sigue en pie y tiene un pago?
 * Devuelve, por uso, el valor vigente del servicio: es la base de los créditos. Si la
 * reserva se cancela, el uso deja de contar solo (como en AppleFix, se calcula al leer).
 */
async function paidRedemptionIds(rows: Redemption[]): Promise<Map<string, number>> {
  const quoteIds = Array.from(new Set(rows.map((r) => r.quote_id)))
  if (quoteIds.length === 0) return new Map()
  const { data: bookings } = await supabaseAdmin
    .from('bookings')
    .select('quote_id, status, is_provisional, payment_status, amount_paid, original_price, total_price, adjusted_price')
    .in('quote_id', quoteIds)
  const byQuote = new Map(((bookings || []) as Record<string, any>[]).map((b) => [b.quote_id, b]))
  const out = new Map<string, number>()
  for (const r of rows) {
    const b = byQuote.get(r.quote_id)
    if (!b || ['cancelled', 'no_show'].includes(String(b.status))) continue
    const paid = b.payment_status === 'approved' || Number(b.amount_paid) > 0
    const price = Math.round(Number(b.adjusted_price) || Number(b.original_price) || Number(b.total_price) || 0)
    if (paid) out.set(r.id, price > 0 ? price : r.amount_after)
  }
  return out
}

/**
 * Entrega los créditos de los referidos que ya completaron los dos pasos. `ownerId` lo
 * acota a un cliente. El `redemption_id` único hace que un mismo referido no pague dos veces
 * aunque dos pantallas lo procesen a la vez.
 */
export async function grantReferralCredits(config: MarketingConfig, ownerId?: string): Promise<number> {
  let couponsQuery = supabaseAdmin.from('coupons').select('id, owner_customer_id, description').eq('origin', 'referido')
  if (ownerId) couponsQuery = couponsQuery.eq('owner_customer_id', ownerId)
  const { data: coupons } = await couponsQuery
  if (!coupons || coupons.length === 0) return 0
  const ownerByCoupon = new Map(coupons.map((c) => [c.id, c.owner_customer_id as string]))
  // Los recomendadores (conserjes) ganan con su propio premio si está configurado.
  const recommenderCoupons = new Set(coupons.filter((c) => String(c.description || '').startsWith(RECOMMENDER_PREFIX)).map((c) => c.id))
  const { reward: recommenderReward } = recommenderCoupons.size ? await getRecommenderReward() : { reward: null }
  const recommenderConfig: MarketingConfig | null = recommenderReward
    ? { ...config, pesosPerToken: null, rewardKind: recommenderReward.kind, rewardValue: recommenderReward.value }
    : null

  const { data: uses } = await supabaseAdmin
    .from('coupon_redemptions')
    .select('id, coupon_id, customer_id, quote_id, amount_after, created_at')
    .in('coupon_id', coupons.map((c) => c.id))
    // Los que ya recibieron cupón de premio (antes de los créditos) no cobran de nuevo.
    .is('reward_coupon_id', null)
  const rows = (uses || []) as Redemption[]
  if (rows.length === 0) return 0

  const [paid, { data: already }] = await Promise.all([
    paidRedemptionIds(rows),
    supabaseAdmin.from('customer_credit_movements').select('redemption_id').in('redemption_id', rows.map((r) => r.id)),
  ])
  const done = new Set((already || []).map((m) => m.redemption_id))

  let granted = 0
  for (const r of rows) {
    if (!paid.has(r.id) || done.has(r.id)) continue
    const owner = ownerByCoupon.get(r.coupon_id)
    const rule = recommenderConfig && recommenderCoupons.has(r.coupon_id) ? recommenderConfig : config
    const amount = creditsFor(rule, paid.get(r.id) || r.amount_after)
    if (!owner || amount <= 0) continue
    const { error } = await supabaseAdmin.from('customer_credit_movements').insert({
      customer_id: owner,
      amount,
      kind: 'referido',
      redemption_id: r.id,
      note: 'Referido validado',
      created_by: 'sistema',
    })
    if (error) continue
    granted++
    await notifyReferralReward(owner, r, amount)
  }
  return granted
}

/**
 * Le avisa por correo a quien refirió que ya tiene sus créditos. Best-effort: los créditos
 * ya quedaron sumados y se ven en «Beneficios» aunque el correo no salga.
 */
async function notifyReferralReward(ownerId: string, r: Redemption, amount: number): Promise<void> {
  // Sin Resend el correo iría al n8n, que no conoce este aviso.
  if (!resendConfigured()) return
  try {
    const { data: people } = await supabaseAdmin.from('customers').select('id, name, email').in('id', [ownerId, r.customer_id])
    const owner = (people || []).find((p) => p.id === ownerId)
    if (!owner?.email) return
    const referred = (people || []).find((p) => p.id === r.customer_id)
    await sendSystemEmail(
      {
        event: 'referral_reward',
        cliente: { nombre: owner.name, email: owner.email },
        referido: referred?.name ? firstName(referred.name) : null,
        monto: amount,
        url: `${siteBaseUrl()}/mi-cuenta/beneficios`,
      },
      { label: 'creditos-referido', idempotencyKey: `referral-reward/${r.id}`, timeoutMs: 8_000 }
    )
  } catch (error) {
    console.warn('[referralCredits] El aviso de créditos no salió:', error instanceof Error ? error.message : error)
  }
}

const firstName = (name: string | null | undefined) => String(name || '').trim().split(/\s+/)[0] || 'Alguien'

export async function referralSteps(couponIds: string[]): Promise<(ReferralStep & { couponId: string; quoteId: string })[]> {
  if (couponIds.length === 0) return []
  const { data: uses } = await supabaseAdmin
    .from('coupon_redemptions')
    .select('id, coupon_id, customer_id, quote_id, amount_after, created_at')
    .in('coupon_id', couponIds)
    .order('created_at', { ascending: false })
  const rows = (uses || []) as Redemption[]
  if (rows.length === 0) return []
  const [paid, { data: movements }, { data: customers }] = await Promise.all([
    paidRedemptionIds(rows),
    supabaseAdmin.from('customer_credit_movements').select('redemption_id, amount').in('redemption_id', rows.map((r) => r.id)),
    supabaseAdmin.from('customers').select('id, name').in('id', Array.from(new Set(rows.map((r) => r.customer_id)))),
  ])
  const creditBy = new Map((movements || []).map((m) => [m.redemption_id, m.amount as number]))
  const nameBy = new Map((customers || []).map((c) => [c.id, c.name as string | null]))
  return rows.map((r) => ({
    id: r.id,
    couponId: r.coupon_id,
    quoteId: r.quote_id,
    referredName: firstName(nameBy.get(r.customer_id)),
    quotedAt: r.created_at,
    paid: paid.has(r.id),
    credits: creditBy.get(r.id) || 0,
  }))
}

const toBank = (row: Record<string, any>): BankData => ({
  holderName: row.holder_name,
  holderRut: row.holder_rut,
  bankName: row.bank_name,
  accountType: row.account_type,
  accountNumber: row.account_number,
  email: row.email ?? null,
})

/** Todo lo que el cliente ve de sus créditos en «Beneficios». */
export async function getCustomerCredits(customerId: string): Promise<CustomerCredits> {
  const empty: CustomerCredits = { available: false, balance: 0, referrals: [], movements: [], bank: null, openWithdrawal: null, withdrawals: [] }
  if (!(await creditsAvailable())) return empty

  const [{ data: movements }, { data: bank }, { data: withdrawals }, { data: coupons }] = await Promise.all([
    supabaseAdmin.from('customer_credit_movements').select('id, amount, kind, note, created_at').eq('customer_id', customerId).order('created_at', { ascending: false }),
    supabaseAdmin.from('customer_bank_accounts').select('*').eq('customer_id', customerId).maybeSingle(),
    supabaseAdmin.from('credit_withdrawals').select('id, amount, status, requested_at, note').eq('customer_id', customerId).order('requested_at', { ascending: false }),
    supabaseAdmin.from('coupons').select('id').eq('owner_customer_id', customerId).eq('origin', 'referido'),
  ])
  const steps = await referralSteps((coupons || []).map((c) => c.id))
  const open = (withdrawals || []).find((w) => w.status === 'solicitado')
  return {
    available: true,
    balance: (movements || []).reduce((sum, m) => sum + (m.amount as number), 0),
    referrals: steps.map(({ couponId: _c, quoteId: _q, ...step }) => step),
    movements: (movements || []).map((m) => ({ id: m.id, amount: m.amount, kind: m.kind, note: m.note, createdAt: m.created_at })),
    bank: bank ? toBank(bank) : null,
    openWithdrawal: open ? { id: open.id, amount: open.amount, requestedAt: open.requested_at } : null,
    withdrawals: (withdrawals || []).map((w) => ({ id: w.id, amount: w.amount, status: w.status as WithdrawalStatus, requestedAt: w.requested_at, note: w.note })),
  }
}

/** Datos de transferencia del cliente, para «Mis datos». `available` = existe la tabla (add_referral_credits.sql). */
export async function getCustomerBankData(customerId: string): Promise<{ available: boolean; bank: BankData | null }> {
  if (!(await creditsAvailable())) return { available: false, bank: null }
  const { data } = await supabaseAdmin.from('customer_bank_accounts').select('*').eq('customer_id', customerId).maybeSingle()
  return { available: true, bank: data ? toBank(data) : null }
}

/** Valida y guarda los datos de transferencia del cliente. */
export async function saveBankData(customerId: string, body: any): Promise<BankData> {
  const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
  const holderName = text(body?.holderName, 120)
  const bankName = text(body?.bankName, 80)
  const accountType = text(body?.accountType, 40)
  const accountNumber = text(body?.accountNumber, 30).replace(/[\s.-]/g, '')
  const email = text(body?.email, 200).toLowerCase()
  if (!holderName) throw new CreditError('Falta el nombre del titular de la cuenta.')
  if (!isValidRut(body?.holderRut)) throw new CreditError('El RUT del titular no es válido. Revisa el dígito verificador.')
  if (!bankName) throw new CreditError('Falta el banco.')
  if (!(ACCOUNT_TYPES as readonly string[]).includes(accountType)) throw new CreditError('Elige el tipo de cuenta.')
  if (!/^\d{4,20}$/.test(accountNumber)) throw new CreditError('El número de cuenta debe tener solo dígitos (entre 4 y 20).')
  if (email && !isValidEmail(email)) throw new CreditError('El correo para el comprobante no es válido.')

  const row = {
    customer_id: customerId,
    holder_name: holderName,
    holder_rut: normalizeRut(body.holderRut),
    bank_name: bankName,
    account_type: accountType,
    account_number: accountNumber,
    email: email || null,
    updated_at: new Date().toISOString(),
  }
  const { error } = await supabaseAdmin.from('customer_bank_accounts').upsert(row, { onConflict: 'customer_id' })
  if (error) {
    console.error('[referralCredits] Error guardando datos bancarios:', error.message)
    throw new CreditError('No se pudieron guardar tus datos. Intenta de nuevo.', 500)
  }
  return toBank(row)
}

/**
 * Solicita el retiro de TODO el saldo. Exige datos de transferencia cargados. Descuenta el
 * saldo en el mismo acto y le avisa por correo a Yo me encargo (`ADMIN_NOTIFICATION_EMAIL`).
 * El índice único de «solicitado» impide dos retiros abiertos a la vez.
 */
export async function requestWithdrawal(customerId: string): Promise<{ amount: number; emailed: boolean }> {
  if (!(await creditsAvailable())) throw new CreditError('Los créditos todavía no están habilitados.', 409)
  const [{ data: bank }, { data: movements }, { data: customer }] = await Promise.all([
    supabaseAdmin.from('customer_bank_accounts').select('*').eq('customer_id', customerId).maybeSingle(),
    supabaseAdmin.from('customer_credit_movements').select('amount').eq('customer_id', customerId),
    supabaseAdmin.from('customers').select('id, code, name, email, phone').eq('id', customerId).maybeSingle(),
  ])
  if (!customer) throw new CreditError('Cuenta no encontrada.', 404)
  if (!bank) throw new CreditError('Primero carga tus datos de transferencia: sin ellos no podemos pagarte.')
  const balance = (movements || []).reduce((sum, m) => sum + (m.amount as number), 0)
  if (balance <= 0) throw new CreditError('No tienes créditos para retirar.')

  const { data: withdrawal, error } = await supabaseAdmin
    .from('credit_withdrawals')
    .insert({
      customer_id: customerId,
      amount: balance,
      holder_name: bank.holder_name,
      holder_rut: bank.holder_rut,
      bank_name: bank.bank_name,
      account_type: bank.account_type,
      account_number: bank.account_number,
      email: bank.email,
    })
    .select('id')
    .single()
  if (error || !withdrawal) {
    if (error?.code === '23505') throw new CreditError('Ya tienes un retiro en curso. Te avisaremos cuando esté transferido.', 409)
    console.error('[referralCredits] Error creando el retiro:', error?.message)
    throw new CreditError('No se pudo registrar el retiro. Intenta de nuevo.', 500)
  }
  const { error: moveError } = await supabaseAdmin.from('customer_credit_movements').insert({
    customer_id: customerId,
    amount: -balance,
    kind: 'retiro',
    withdrawal_id: withdrawal.id,
    note: 'Retiro solicitado',
    created_by: 'cliente',
  })
  if (moveError) {
    // Sin el descuento no puede quedar un retiro abierto: se deshace.
    await supabaseAdmin.from('credit_withdrawals').delete().eq('id', withdrawal.id)
    console.error('[referralCredits] Error descontando el saldo:', moveError.message)
    throw new CreditError('No se pudo registrar el retiro. Intenta de nuevo.', 500)
  }

  // El aviso es best-effort: el retiro ya quedó registrado y se ve en Marketing aunque el correo falle.
  let emailed = false
  const to = process.env.ADMIN_NOTIFICATION_EMAIL
  if (to) {
    const result = await sendSystemEmail(
      {
        event: 'credit_withdrawal_request',
        to,
        cliente: { nombre: customer.name, email: customer.email, telefono: customer.phone, codigo: customer.code },
        monto: balance,
        banco: {
          titular: bank.holder_name,
          rut: formatRut(bank.holder_rut),
          banco: bank.bank_name,
          tipo: bank.account_type,
          numero: bank.account_number,
          email: bank.email,
        },
      },
      { label: 'retiro-creditos', idempotencyKey: `credit-withdrawal/${withdrawal.id}` }
    )
    emailed = result.ok && result.body?.success === true
    if (!emailed) console.warn('[referralCredits] El aviso de retiro no salió:', result.error || 'sin confirmación')
  }
  return { amount: balance, emailed }
}

// ───────────────────────── Admin ─────────────────────────

export async function getAdminCredits(config: MarketingConfig, live: boolean): Promise<AdminCreditsData> {
  if (!(await creditsAvailable())) return { available: false, withdrawals: [], referrals: [], outstanding: 0 }
  if (live) await grantReferralCredits(config)

  const [{ data: withdrawals }, { data: coupons }, { data: movements }] = await Promise.all([
    supabaseAdmin.from('credit_withdrawals').select('*').order('requested_at', { ascending: false }).limit(200),
    supabaseAdmin.from('coupons').select('id, code, owner_customer_id').eq('origin', 'referido'),
    supabaseAdmin.from('customer_credit_movements').select('amount'),
  ])
  const customerIds = Array.from(
    new Set([...(withdrawals || []).map((w) => w.customer_id), ...(coupons || []).map((c) => c.owner_customer_id)].filter(Boolean))
  )
  const { data: customers } = customerIds.length
    ? await supabaseAdmin.from('customers').select('id, code, name, email').in('id', customerIds)
    : { data: [] as { id: string; code: string; name: string | null; email: string }[] }
  const byId = new Map((customers || []).map((c) => [c.id, c]))
  const labelOf = (id: string) => {
    const c = byId.get(id)
    return c ? `${c.name || c.email} (${c.code})` : 'Cliente'
  }

  const steps = await referralSteps((coupons || []).map((c) => c.id))
  const couponById = new Map((coupons || []).map((c) => [c.id, c]))
  const referrals: AdminReferral[] = steps.map(({ couponId, ...step }) => {
    const coupon = couponById.get(couponId)
    return { ...step, code: coupon?.code || '', ownerLabel: coupon ? labelOf(coupon.owner_customer_id) : 'Cliente' }
  })

  const list: AdminWithdrawal[] = ((withdrawals || []) as Record<string, any>[]).map((w) => ({
    id: w.id,
    customerLabel: labelOf(w.customer_id),
    customerEmail: byId.get(w.customer_id)?.email || '',
    amount: w.amount,
    status: w.status,
    bank: toBank(w),
    requestedAt: w.requested_at,
    resolvedAt: w.resolved_at,
    resolvedBy: w.resolved_by,
    note: w.note,
  }))
  return {
    available: true,
    withdrawals: list,
    referrals,
    outstanding: (movements || []).reduce((sum, m) => sum + (m.amount as number), 0),
  }
}

/** Marca un retiro como transferido, o lo rechaza y devuelve los créditos al cliente. */
export async function resolveWithdrawal(input: {
  id: string
  decision: 'pagado' | 'rechazado'
  note?: string | null
  actor: string
}): Promise<{ customerId: string; amount: number }> {
  const note = String(input.note || '').trim().slice(0, 500) || null
  if (input.decision === 'rechazado' && !note) throw new CreditError('Escribe el motivo del rechazo: lo lee el cliente.')
  // La condición en el UPDATE hace que solo uno de dos clics simultáneos lo resuelva.
  const { data: row, error } = await supabaseAdmin
    .from('credit_withdrawals')
    .update({ status: input.decision, note, resolved_at: new Date().toISOString(), resolved_by: input.actor })
    .eq('id', input.id)
    .eq('status', 'solicitado')
    .select('id, customer_id, amount')
    .maybeSingle()
  if (error) throw new CreditError('No se pudo guardar.', 500)
  if (!row) throw new CreditError('Ese retiro ya estaba resuelto.', 409)
  if (input.decision === 'rechazado') {
    const { error: backError } = await supabaseAdmin.from('customer_credit_movements').insert({
      customer_id: row.customer_id,
      amount: row.amount,
      kind: 'devolucion',
      withdrawal_id: row.id,
      note: 'Retiro rechazado: créditos devueltos',
      created_by: input.actor,
    })
    if (backError) console.error('[referralCredits] El retiro se rechazó pero no se devolvieron los créditos:', backError.message)
  }
  return { customerId: row.customer_id, amount: row.amount }
}
