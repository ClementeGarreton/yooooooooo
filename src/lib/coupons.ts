/**
 * Cupones y referidos (etapa 2, paso 8 / Módulo 5).
 *
 * Decisiones de Francisco (03-10-2026):
 *   - Los cupones se usan en el panel del cliente, al reservar una cotización. Desde el
 *     15-10-2026 (campaña OCTUBRE, «reservando en nuestra web») también en el cotizador
 *     web: ahí el cliente se reconoce por su correo (`quoteCoupon` con `customerId` null si
 *     todavía no tiene ficha).
 *   - Referidos: cada cliente tiene un código. A quien llega con él le da un descuento en
 *     su PRIMER servicio; cuando ese servicio se completa, quien refirió recibe un cupón
 *     de premio. Los montos se configuran en el admin y el programa parte apagado.
 *
 * El descuento se aplica al precio de la cotización ANTES de calcular el abono del 50% o
 * el pago completo con 5%: la pre-reserva nace con el precio ya rebajado, así el webhook
 * de Flow, el saldo y el panel admin siguen funcionando sin saber de cupones. Lo que se
 * rebajó y por qué queda en `coupon_redemptions`.
 *
 * Un uso CUENTA cuando su reserva es real (dejó de ser pre-reserva o tiene el pago
 * aprobado), no está cancelada y sigue al precio con descuento. Un cupón puesto en una
 * reserva que nunca se pagó no gasta un uso ni premia a nadie.
 */

import { creditsAvailable, getCustomerCredits, grantReferralCredits } from '@/lib/referralCredits'
import { supabaseAdmin } from '@/lib/supabase'
import { chileTodayString } from '@/lib/vehicleAssignment'
import { computeQuoteAmounts } from '@/lib/quoteCheckout'
import {
  couponValueLabel,
  type AdminCoupon,
  type CouponKind,
  type CouponOrigin,
  type CouponQuote,
  type MarketingConfig,
} from '@/lib/couponTypes'

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CODE_RE = /^[A-Z0-9]{4,20}$/


interface CouponRow {
  id: string
  code: string
  origin: CouponOrigin
  kind: CouponKind | null
  value: number | null
  min_amount: number
  max_uses: number | null
  valid_from: string | null
  valid_until: string | null
  active: boolean
  description: string | null
  owner_customer_id: string | null
  created_at: string
  /** add_coupon_max_discount.sql: tope del descuento en pesos. Ausente sin la migración. */
  max_discount?: number | null
}

const COUPON_FIELDS =
  'id, code, origin, kind, value, min_amount, max_uses, valid_from, valid_until, active, description, owner_customer_id, created_at'

export class CouponError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message)
    this.name = 'CouponError'
  }
}

/** 42P01 / PGRST205 = falta correr add_coupons.sql. */
export function isMissingCouponsTable(error: { code?: string } | null | undefined): boolean {
  return error?.code === '42P01' || error?.code === 'PGRST205'
}

export function normalizeCouponCode(value: unknown): string {
  return String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20)
}

// ───────────────────────── Configuración de referidos ─────────────────────────

const DEFAULT_CONFIG: MarketingConfig = {
  referralEnabled: false,
  referredKind: null,
  referredValue: null,
  rewardKind: null,
  rewardValue: null,
  rewardValidDays: 180,
  referredCap: null,
  onlyNew: true,
  pesosPerToken: null,
}

export async function getMarketingConfig(): Promise<{ available: boolean; config: MarketingConfig }> {
  const { data, error } = await supabaseAdmin.from('marketing_config').select('*').eq('id', 1).maybeSingle()
  if (error) {
    if (!isMissingCouponsTable(error)) console.error('[coupons] Error leyendo la configuración:', error)
    return { available: !isMissingCouponsTable(error), config: DEFAULT_CONFIG }
  }
  if (!data) return { available: true, config: DEFAULT_CONFIG }
  return {
    available: true,
    config: {
      referralEnabled: data.referral_enabled === true,
      referredKind: data.referred_kind,
      referredValue: data.referred_value,
      rewardKind: data.reward_kind,
      rewardValue: data.reward_value,
      rewardValidDays: data.reward_valid_days || 180,
      // Columnas de add_referral_rules.sql: sin la migración quedan en su valor por defecto.
      referredCap: data.referred_cap ?? null,
      onlyNew: data.only_new !== false,
      pesosPerToken: data.pesos_per_token ?? null,
    },
  }
}

/** ¿Los referidos están encendidos Y con los dos montos definidos? */
export function referralsLive(config: MarketingConfig): boolean {
  // Lo que gana quien refiere: créditos según lo pagado (`pesosPerToken`, como AppleFix) o
  // el premio anterior (monto fijo o porcentaje).
  const hasReward = Boolean(config.pesosPerToken) || Boolean(config.rewardKind && config.rewardValue)
  return Boolean(config.referralEnabled && config.referredKind && config.referredValue && hasReward)
}

function parseBenefit(kind: unknown, value: unknown, label: string): { kind: CouponKind; value: number } {
  if (kind !== 'porcentaje' && kind !== 'monto') throw new CouponError(`${label}: elige porcentaje o monto.`)
  const n = Math.round(Number(value))
  if (!Number.isFinite(n) || n <= 0) throw new CouponError(`${label}: escribe un valor mayor que cero.`)
  if (kind === 'porcentaje' && n > 100) throw new CouponError(`${label}: el porcentaje no puede pasar de 100.`)
  return { kind, value: n }
}

export async function saveMarketingConfig(body: any, actor: string): Promise<MarketingConfig> {
  const enabled = body?.referralEnabled === true
  const hasReferred = body?.referredKind || body?.referredValue
  const hasReward = body?.rewardKind || body?.rewardValue
  // Encender exige los dos montos; apagado, se pueden dejar a medio definir.
  const referred = enabled || hasReferred ? parseBenefit(body?.referredKind, body?.referredValue, 'Descuento del referido') : null
  const optionalPositive = (value: unknown, label: string): number | null => {
    if (value === null || value === undefined || value === '') return null
    const n = Math.round(Number(value))
    if (!Number.isFinite(n) || n <= 0) throw new CouponError(`${label}: escribe un número mayor que cero, o déjalo vacío.`)
    return n
  }
  const referredCap = optionalPositive(body?.referredCap, 'Tope del descuento')
  const pesosPerToken = optionalPositive(body?.pesosPerToken, 'Pesos por crédito')
  const onlyNew = body?.onlyNew !== false
  // Con «pesos por crédito» definido, el premio anterior deja de ser obligatorio.
  const reward =
    hasReward || (enabled && !pesosPerToken) ? parseBenefit(body?.rewardKind, body?.rewardValue, 'Premio de quien refiere') : null
  const days = Math.round(Number(body?.rewardValidDays)) || 180
  if (days < 1 || days > 3650) throw new CouponError('La vigencia del premio debe estar entre 1 y 3650 días.')

  const base = {
    id: 1,
    referral_enabled: enabled,
    referred_kind: referred?.kind ?? null,
    referred_value: referred?.value ?? null,
    reward_kind: reward?.kind ?? null,
    reward_value: reward?.value ?? null,
    reward_valid_days: days,
    updated_by: actor,
    updated_at: new Date().toISOString(),
  }
  let { error } = await supabaseAdmin
    .from('marketing_config')
    .upsert({ ...base, referred_cap: referredCap, only_new: onlyNew, pesos_per_token: pesosPerToken }, { onConflict: 'id' })
  if (error && (error.code === '42703' || error.code === 'PGRST204')) {
    // Falta add_referral_rules.sql. Si se intentó usar una regla nueva se dice; si no, se
    // guarda lo de siempre.
    if (referredCap !== null || pesosPerToken !== null || onlyNew === false) {
      throw new CouponError('Para usar el tope, «solo clientes nuevos» o los pesos por crédito falta correr la migración add_referral_rules.sql.', 409)
    }
    ;({ error } = await supabaseAdmin.from('marketing_config').upsert(base, { onConflict: 'id' }))
  }
  if (error) throw error
  return (await getMarketingConfig()).config
}

// ───────────────────────── Usos que cuentan ─────────────────────────

interface RedemptionRow {
  id: string
  coupon_id: string
  customer_id: string
  quote_id: string
  booking_id: string | null
  amount_before: number
  discount: number
  amount_after: number
  reward_coupon_id: string | null
  created_at: string
}

const REDEMPTION_FIELDS =
  'id, coupon_id, customer_id, quote_id, booking_id, amount_before, discount, amount_after, reward_coupon_id, created_at'

/** De un lote de usos, los que cuentan y el estado de su reserva. */
async function effectiveRedemptions(rows: RedemptionRow[]): Promise<(RedemptionRow & { bookingStatus: string | null })[]> {
  const quoteIds = Array.from(new Set(rows.map((r) => r.quote_id)))
  if (quoteIds.length === 0) return []
  const { data: bookings } = await supabaseAdmin
    .from('bookings')
    .select('id, quote_id, status, is_provisional, payment_status, original_price, total_price')
    .in('quote_id', quoteIds)
  const byQuote = new Map((bookings || []).map((b: any) => [b.quote_id, b]))
  const out: (RedemptionRow & { bookingStatus: string | null })[] = []
  for (const r of rows) {
    const b: any = byQuote.get(r.quote_id)
    if (!b) continue
    const real = b.is_provisional === false || b.payment_status === 'approved'
    const samePrice = Math.round(Number(b.original_price) || Number(b.total_price) || 0) === r.amount_after
    if (real && samePrice && !['cancelled', 'no_show'].includes(String(b.status))) {
      out.push({ ...r, booking_id: b.id, bookingStatus: b.status })
    }
  }
  return out
}

// ───────────────────────── Validar y aplicar ─────────────────────────

function discountFor(kind: CouponKind, value: number, price: number): number {
  return kind === 'porcentaje' ? Math.round((price * value) / 100) : Math.min(value, price)
}

/**
 * ¿Puede este cliente usar este código en una cotización de este precio? Devuelve el
 * descuento y los montos a pagar, o lanza CouponError con el motivo en palabras del cliente.
 */
export async function quoteCoupon(
  rawCode: unknown,
  /** null = alguien del cotizador web que todavía no tiene ficha de cliente (es nuevo). */
  customerId: string | null,
  quoteId: string,
  price: number
): Promise<CouponQuote & { couponId: string }> {
  const code = normalizeCouponCode(rawCode)
  if (!CODE_RE.test(code)) throw new CouponError('Ese código no existe.')

  // `*`: max_discount es de una migración posterior; pedirla por nombre rompería sin ella.
  const { data: coupon, error } = await supabaseAdmin.from('coupons').select('*').eq('code', code).maybeSingle()
  if (error) {
    if (isMissingCouponsTable(error)) throw new CouponError('Los cupones todavía no están habilitados.', 503)
    throw error
  }
  const row = coupon as CouponRow | null
  if (!row || !row.active) throw new CouponError('Ese código no existe o ya no está activo.')

  const today = chileTodayString()
  if (row.valid_from && today < row.valid_from) throw new CouponError('Ese cupón todavía no empieza a regir.')
  if (row.valid_until && today > row.valid_until) throw new CouponError('Ese cupón ya venció.')

  let kind = row.kind
  let value = row.value
  /** Tope del descuento: solo lo llevan los códigos de referido. */
  let referredCap: number | null = null

  const { data: all } = await supabaseAdmin.from('coupon_redemptions').select(REDEMPTION_FIELDS).eq('coupon_id', row.id)
  // Los usos que cuentan, sin el de esta misma cotización (volver a reservar no es otro uso).
  const used = (await effectiveRedemptions((all || []) as RedemptionRow[])).filter((r) => r.quote_id !== quoteId)

  if (row.origin === 'referido') {
    const { config } = await getMarketingConfig()
    if (!referralsLive(config)) throw new CouponError('El programa de referidos no está activo en este momento.')
    if (customerId && row.owner_customer_id === customerId) throw new CouponError('No puedes usar tu propio código de referido.')
    // Mismas reglas que AppleFix. (1) Mismo RUT en dos fichas = la misma persona.
    const { data: pair } = !customerId ? { data: [] as any[] } : await supabaseAdmin
      .from('customers')
      .select('*')
      .in('id', [customerId, row.owner_customer_id].filter(Boolean) as string[])
    const rutOf = (id: string | null) => {
      const c = (pair || []).find((x: any) => x.id === id) as Record<string, any> | undefined
      const raw = String(c?.rut || c?.rut_declared || '').toUpperCase().replace(/[^0-9K]/g, '').replace(/^0+/, '')
      return raw.length >= 7 ? raw : ''
    }
    if (rutOf(customerId) && rutOf(customerId) === rutOf(row.owner_customer_id)) {
      throw new CouponError('Ese código pertenece a una ficha con tu mismo RUT: no se puede usar el código propio.')
    }
    // (2) Una persona llega referida una sola vez.
    const { data: mine } = !customerId ? { data: [] as any[] } : await supabaseAdmin
      .from('coupon_redemptions')
      .select('quote_id, coupon:coupons(origin)')
      .eq('customer_id', customerId)
    const alreadyReferred = ((mine || []) as any[]).some((r) => {
      const c = Array.isArray(r.coupon) ? r.coupon[0] : r.coupon
      return r.quote_id !== quoteId && c?.origin === 'referido'
    })
    if (alreadyReferred) throw new CouponError('Ya se usó un código de referido antes: se puede usar una sola vez.')
    // (3) Solo clientes nuevos, si la regla está encendida.
    const { data: previous } = !customerId ? { data: [] as any[] } : await supabaseAdmin
      .from('bookings')
      .select('id, quote_id, is_provisional, payment_status, status')
      .eq('customer_id', customerId)
    const hadService = (previous || []).some(
      (b: any) =>
        b.quote_id !== quoteId &&
        (b.is_provisional === false || b.payment_status === 'approved') &&
        !['cancelled', 'no_show'].includes(String(b.status))
    )
    if (config.onlyNew && hadService) throw new CouponError('Los códigos de referido son para el primer servicio.')
    referredCap = config.referredCap
    kind = config.referredKind
    value = config.referredValue
  } else if (row.origin === 'premio') {
    if (row.owner_customer_id !== customerId) throw new CouponError('Ese cupón es de otra persona.')
    if (used.length > 0) throw new CouponError('Ese cupón ya se usó.')
  } else {
    if (row.max_uses !== null && used.length >= row.max_uses) throw new CouponError('Ese cupón ya se agotó.')
    if (customerId && used.some((r) => r.customer_id === customerId)) throw new CouponError('Ya usaste ese cupón.')
  }

  if (!kind || !value) throw new CouponError('Ese cupón no tiene un descuento definido.')
  if (price < row.min_amount) {
    throw new CouponError(`Ese cupón es para servicios desde $${row.min_amount.toLocaleString('es-CL')}.`)
  }

  const rawDiscount = discountFor(kind, value, Math.round(price))
  // Topes: el del referido (configuración) y el del cupón (p. ej. «máximo $100.000»).
  const caps = [referredCap, row.max_discount].filter((n): n is number => typeof n === 'number' && n > 0)
  const discount = caps.length ? Math.min(rawDiscount, ...caps) : rawDiscount
  const finalPrice = Math.round(price) - discount
  // Sin piso del 50%: el abono es de al menos MIN_ABONO_CLP aunque pase de la mitad (Tomás,
  // 19-10-2026), así que el cupón sirve desde el mínimo de cada cupón.
  if (discount <= 0 || finalPrice <= 0) {
    throw new CouponError('Ese cupón no se puede aplicar a una cotización de este monto.')
  }
  const amounts = computeQuoteAmounts(finalPrice)
  return {
    couponId: row.id,
    code: row.code,
    label: `${couponValueLabel(kind, value)} de descuento`,
    discount,
    finalPrice,
    abono50: amounts.abono50,
    full95: amounts.full95,
  }
}

/**
 * Deja registrado (o quita) el cupón de una cotización justo antes de crear el pago. Una
 * cotización lleva a lo más un cupón: reservar de nuevo con otro, o sin ninguno, reemplaza
 * el anterior. `quote` = resultado de `quoteCoupon`, o null si se reserva sin cupón.
 */
export async function setQuoteCoupon(
  customerId: string,
  quoteId: string,
  price: number,
  quote: (CouponQuote & { couponId: string }) | null,
  bookingId: string | null = null
): Promise<void> {
  const { data: existing, error } = await supabaseAdmin
    .from('coupon_redemptions')
    .select('id, coupon_id, reward_coupon_id')
    .eq('quote_id', quoteId)
    .maybeSingle()
  if (error) {
    // Sin la migración no hay cupones que registrar ni que quitar.
    if (isMissingCouponsTable(error)) return
    throw error
  }
  // Un uso que ya premió a alguien es de una reserva pagada: no se reescribe.
  if (existing?.reward_coupon_id) return

  if (!quote) {
    if (existing) await supabaseAdmin.from('coupon_redemptions').delete().eq('id', existing.id)
    return
  }
  const values = {
    coupon_id: quote.couponId,
    customer_id: customerId,
    quote_id: quoteId,
    booking_id: bookingId,
    amount_before: Math.round(price),
    discount: quote.discount,
    amount_after: quote.finalPrice,
  }
  const { error: writeError } = existing
    ? await supabaseAdmin.from('coupon_redemptions').update(values).eq('id', existing.id)
    : await supabaseAdmin.from('coupon_redemptions').insert(values)
  if (writeError) throw writeError
}

// ───────────────────────── Referidos ─────────────────────────

/** Sin 0/O ni 1/I/L: el código se dicta por teléfono y se escribe a mano. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

function randomCode(prefix: string, length: number): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(length))
  return prefix + Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('')
}

/** Solo letras A–Z del nombre de pila: «José Ñandú» → «JOSE». */
function firstNameLetters(name: string | null | undefined): string {
  const first = String(name || '').trim().split(/\s+/)[0] || ''
  return first.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 10)
}

/** Código fácil de decir, como en AppleFix: el nombre de pila + 4 caracteres. Ej.: CAMILA7KQ2. */
function referralCodeFor(name: string | null | undefined): string {
  const base = firstNameLetters(name)
  return randomCode(base.length >= 3 ? base : 'AMIGO', 4)
}

/**
 * «Atendido» = tiene al menos una reserva con un pago y que no se canceló. Igual que en
 * AppleFix, el código para recomendar se entrega recién después del primer servicio pagado.
 */
export async function isAttendedCustomer(customerId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('bookings')
    .select('status, is_provisional, payment_status, amount_paid')
    .eq('customer_id', customerId)
  return (data || []).some(
    (b: any) =>
      !b.is_provisional &&
      !['cancelled', 'no_show'].includes(String(b.status)) &&
      (b.payment_status === 'approved' || Number(b.amount_paid) > 0)
  )
}

/**
 * El código de referido del cliente. Si ya tiene, se devuelve siempre; si no, se crea solo
 * cuando el cliente ya fue atendido (`create: 'if-attended'`, lo normal) o sin condición.
 */
export async function getOrCreateReferralCode(
  customerId: string,
  create: 'if-attended' | 'always' = 'if-attended'
): Promise<string | null> {
  const find = () =>
    supabaseAdmin.from('coupons').select('code').eq('owner_customer_id', customerId).eq('origin', 'referido').maybeSingle()
  const { data: existing, error } = await find()
  if (error) return null
  if (existing) return existing.code
  if (create === 'if-attended' && !(await isAttendedCustomer(customerId))) return null

  const { data: customer } = await supabaseAdmin.from('customers').select('name').eq('id', customerId).maybeSingle()
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data, error: insertError } = await supabaseAdmin
      .from('coupons')
      .insert({ code: referralCodeFor(customer?.name), origin: 'referido', owner_customer_id: customerId, description: 'Código de referido' })
      .select('code')
      .single()
    if (!insertError) return data.code
    // 23505: o chocó el código (se reintenta) o ya lo creó otra petición (se lee).
    const { data: raced } = await find()
    if (raced) return raced.code
  }
  return null
}

/**
 * Entrega los premios pendientes: por cada uso de un código de referido cuyo servicio ya
 * se completó, un cupón de premio para el dueño del código. Se llama al abrir el panel del
 * cliente o la pestaña de marketing del admin (no hay un proceso de fondo): el premio
 * aparece la próxima vez que alguien mira. `ownerId` lo acota a un cliente.
 */
export async function issuePendingRewards(ownerId?: string): Promise<number> {
  const { available, config } = await getMarketingConfig()
  if (!available || !referralsLive(config)) return 0
  // Con add_referral_credits.sql corrida, el premio son CRÉDITOS (al pagar), no un cupón.
  if (await creditsAvailable()) return grantReferralCredits(config, ownerId)

  let couponsQuery = supabaseAdmin.from('coupons').select('id, owner_customer_id').eq('origin', 'referido')
  if (ownerId) couponsQuery = couponsQuery.eq('owner_customer_id', ownerId)
  const { data: referralCoupons } = await couponsQuery
  if (!referralCoupons || referralCoupons.length === 0) return 0
  const ownerByCoupon = new Map(referralCoupons.map((c) => [c.id, c.owner_customer_id as string]))

  const { data: pending } = await supabaseAdmin
    .from('coupon_redemptions')
    .select(REDEMPTION_FIELDS)
    .in('coupon_id', referralCoupons.map((c) => c.id))
    .is('reward_coupon_id', null)
  const due = (await effectiveRedemptions((pending || []) as RedemptionRow[])).filter((r) => r.bookingStatus === 'completed')

  let issued = 0
  for (const redemption of due) {
    const owner = ownerByCoupon.get(redemption.coupon_id)
    if (!owner) continue
    const until = new Date(Date.now() + config.rewardValidDays * 86_400_000).toISOString().slice(0, 10)
    const { data: reward, error } = await supabaseAdmin
      .from('coupons')
      .insert({
        code: randomCode('GRACIAS', 6),
        origin: 'premio',
        kind: config.rewardKind,
        value: config.rewardValue,
        max_uses: 1,
        valid_until: until,
        owner_customer_id: owner,
        description: 'Premio por referir',
        created_by: 'sistema',
      })
      .select('id')
      .single()
    if (error || !reward) continue
    // Se reclama el uso con la condición en el UPDATE: si dos pantallas lo procesan a la
    // vez, una sola se queda con el premio y la otra borra el cupón que alcanzó a crear.
    const { data: claimed } = await supabaseAdmin
      .from('coupon_redemptions')
      .update({ reward_coupon_id: reward.id })
      .eq('id', redemption.id)
      .is('reward_coupon_id', null)
      .select('id')
      .maybeSingle()
    if (claimed) issued++
    else await supabaseAdmin.from('coupons').delete().eq('id', reward.id)
  }
  return issued
}

/** Lo que el cliente ve en «Beneficios»: su código, sus referidos y sus cupones de premio. */
export async function getCustomerBenefits(customerId: string) {
  const { available, config } = await getMarketingConfig()
  const live = available && referralsLive(config)
  if (live) await issuePendingRewards(customerId)

  const referralCode = live ? await getOrCreateReferralCode(customerId) : null
  const today = chileTodayString()

  const { data: owned } = available
    ? await supabaseAdmin.from('coupons').select(COUPON_FIELDS).eq('owner_customer_id', customerId)
    : { data: [] as any[] }
  const rows = (owned || []) as CouponRow[]
  const referral = rows.find((c) => c.origin === 'referido')
  const prizes = rows.filter((c) => c.origin === 'premio')

  let referredCount = 0
  let completedCount = 0
  if (referral) {
    const { data: uses } = await supabaseAdmin.from('coupon_redemptions').select(REDEMPTION_FIELDS).eq('coupon_id', referral.id)
    const effective = await effectiveRedemptions((uses || []) as RedemptionRow[])
    referredCount = effective.length
    completedCount = effective.filter((r) => r.bookingStatus === 'completed').length
  }

  let usedPrizeIds = new Set<string>()
  if (prizes.length > 0) {
    const { data: uses } = await supabaseAdmin.from('coupon_redemptions').select(REDEMPTION_FIELDS).in('coupon_id', prizes.map((p) => p.id))
    usedPrizeIds = new Set((await effectiveRedemptions((uses || []) as RedemptionRow[])).map((r) => r.coupon_id))
  }

  const credits = await getCustomerCredits(customerId)

  return {
    live,
    credits,
    /** Lo que gana quien refiere, cuando el premio son créditos. */
    rewardCredits:
      !credits.available
        ? null
        : config.pesosPerToken
          ? `1 crédito por cada $${config.pesosPerToken.toLocaleString('es-CL')} que pague`
          : config.rewardKind && config.rewardValue
            ? config.rewardKind === 'monto'
              ? `${config.rewardValue.toLocaleString('es-CL')} créditos`
              : `el ${config.rewardValue}% de lo que pague, en créditos`
            : null,
    referralCode,
    /** Programa encendido pero todavía sin código: falta el primer servicio pagado. */
    codePending: live && !referralCode,
    referredLabel: live
      ? couponValueLabel(config.referredKind, config.referredValue) +
        (config.referredCap ? ` (hasta $${config.referredCap.toLocaleString('es-CL')})` : '')
      : null,
    rewardLabel: live ? couponValueLabel(config.rewardKind, config.rewardValue) : null,
    referredCount,
    completedCount,
    prizes: prizes
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((p) => ({
        code: p.code,
        label: couponValueLabel(p.kind, p.value),
        validUntil: p.valid_until,
        state: usedPrizeIds.has(p.id) ? ('usado' as const) : p.valid_until && p.valid_until < today ? ('vencido' as const) : ('disponible' as const),
      })),
  }
}

// ───────────────────────── Admin ─────────────────────────

export async function listAdminCoupons(): Promise<{ available: boolean; coupons: AdminCoupon[] }> {
  await issuePendingRewards()
  const { data, error } = await supabaseAdmin.from('coupons').select('*').order('created_at', { ascending: false }).limit(500)
  if (error) {
    if (!isMissingCouponsTable(error)) console.error('[coupons] Error listando:', error)
    return { available: !isMissingCouponsTable(error), coupons: [] }
  }
  const rows = (data || []) as CouponRow[]
  const ownerIds = Array.from(new Set(rows.map((r) => r.owner_customer_id).filter((id): id is string => !!id)))
  const [{ data: owners }, { data: redemptions }] = await Promise.all([
    ownerIds.length ? supabaseAdmin.from('customers').select('id, code, name, email').in('id', ownerIds) : Promise.resolve({ data: [] as any[] }),
    rows.length ? supabaseAdmin.from('coupon_redemptions').select(REDEMPTION_FIELDS).in('coupon_id', rows.map((r) => r.id)) : Promise.resolve({ data: [] as any[] }),
  ])
  const ownerById = new Map((owners || []).map((o: any) => [o.id, `${o.name || o.email} · ${o.code}`]))
  const uses = new Map<string, number>()
  for (const r of await effectiveRedemptions((redemptions || []) as RedemptionRow[])) {
    uses.set(r.coupon_id, (uses.get(r.coupon_id) || 0) + 1)
  }
  return {
    available: true,
    coupons: rows.map((r) => ({
      id: r.id,
      code: r.code,
      origin: r.origin,
      kind: r.kind,
      value: r.value,
      minAmount: r.min_amount,
      maxDiscount: r.max_discount ?? null,
      maxDiscountAvailable: 'max_discount' in r,
      maxUses: r.max_uses,
      validFrom: r.valid_from,
      validUntil: r.valid_until,
      active: r.active,
      description: r.description,
      ownerLabel: r.owner_customer_id ? ownerById.get(r.owner_customer_id) || null : null,
      uses: uses.get(r.id) || 0,
      createdAt: r.created_at,
    })),
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** Condiciones de un cupón manual que se pueden poner al crearlo y cambiar después. */
function parseCouponTerms(body: any) {
  const minAmount = Math.max(0, Math.round(Number(body?.minAmount) || 0))
  const maxUses = body?.maxUses === null || body?.maxUses === '' || body?.maxUses === undefined ? null : Math.round(Number(body.maxUses))
  if (maxUses !== null && !(maxUses > 0)) throw new CouponError('Los usos máximos deben ser un número mayor que cero, o vacío para no limitar.')
  const maxDiscount =
    body?.maxDiscount === null || body?.maxDiscount === '' || body?.maxDiscount === undefined ? null : Math.round(Number(body.maxDiscount))
  if (maxDiscount !== null && !(maxDiscount > 0)) throw new CouponError('El descuento máximo debe ser un monto mayor que cero, o vacío para no limitar.')
  const date = (v: unknown, label: string) => {
    if (!v) return null
    if (typeof v !== 'string' || !DATE_RE.test(v)) throw new CouponError(`${label}: fecha inválida.`)
    return v
  }
  const validFrom = date(body?.validFrom, 'Desde')
  const validUntil = date(body?.validUntil, 'Hasta')
  if (validFrom && validUntil && validUntil < validFrom) throw new CouponError('La fecha «hasta» es anterior a la fecha «desde».')
  return {
    min_amount: minAmount,
    max_uses: maxUses,
    valid_from: validFrom,
    valid_until: validUntil,
    description: typeof body?.description === 'string' ? body.description.trim().slice(0, 200) || null : null,
    // Solo se manda si tiene valor: sin add_coupon_max_discount.sql la columna no existe.
    ...(maxDiscount !== null ? { max_discount: maxDiscount } : {}),
    maxDiscount,
  }
}

/** 42703 / PGRST204 = falta una columna (add_coupon_max_discount.sql). */
const isMissingColumn = (error: { code?: string } | null) => error?.code === '42703' || error?.code === 'PGRST204'

/** Crea un cupón manual (campaña). */
export async function createManualCoupon(body: any, actor: string) {
  const code = normalizeCouponCode(body?.code)
  if (!CODE_RE.test(code)) throw new CouponError('El código debe tener entre 4 y 20 letras o números.')
  const benefit = parseBenefit(body?.kind, body?.value, 'Descuento')
  const { maxDiscount: _cap, ...terms } = parseCouponTerms(body)

  const { data, error } = await supabaseAdmin
    .from('coupons')
    .insert({ code, origin: 'manual', kind: benefit.kind, value: benefit.value, ...terms, created_by: actor })
    .select(COUPON_FIELDS)
    .single()
  if (error) {
    if (error.code === '23505') throw new CouponError('Ya existe un cupón con ese código.', 409)
    if (isMissingColumn(error)) throw new CouponError('Para poner un descuento máximo falta correr la migración add_coupon_max_discount.sql.', 409)
    throw error
  }
  return data as CouponRow
}

/**
 * Cambia las condiciones de un cupón manual (mínimo, descuento máximo, usos, fechas,
 * descripción). El código y el descuento no se tocan: los usos pasados se hicieron con ellos.
 */
export async function updateManualCoupon(couponId: string, body: any): Promise<{ code: string; changes: Record<string, { from: unknown; to: unknown }> }> {
  if (!UUID_RE.test(couponId)) throw new CouponError('Cupón no encontrado', 404)
  const { data: before } = await supabaseAdmin.from('coupons').select('*').eq('id', couponId).maybeSingle()
  if (!before) throw new CouponError('Cupón no encontrado', 404)
  if (before.origin !== 'manual') throw new CouponError('Solo se editan los cupones de campaña.')
  const { maxDiscount, ...terms } = parseCouponTerms(body)
  const update: Record<string, unknown> = { ...terms }
  // Quitar el tope (vacío) también se guarda, si la columna existe.
  if (maxDiscount === null && 'max_discount' in before) update.max_discount = null
  const { error } = await supabaseAdmin.from('coupons').update(update).eq('id', couponId)
  if (error) {
    if (isMissingColumn(error)) throw new CouponError('Para poner un descuento máximo falta correr la migración add_coupon_max_discount.sql.', 409)
    throw error
  }
  const changes: Record<string, { from: unknown; to: unknown }> = {}
  for (const [key, value] of Object.entries(update)) if ((before[key] ?? null) !== (value ?? null)) changes[key] = { from: before[key] ?? null, to: value ?? null }
  return { code: before.code, changes }
}

/** Activa o desactiva un cupón. Desactivado deja de aceptarse; sus usos pasados no cambian. */
export async function setCouponActive(couponId: string, active: boolean) {
  if (!UUID_RE.test(couponId)) throw new CouponError('Cupón no encontrado', 404)
  const { data, error } = await supabaseAdmin.from('coupons').update({ active }).eq('id', couponId).select(COUPON_FIELDS).maybeSingle()
  if (error) throw error
  if (!data) throw new CouponError('Cupón no encontrado', 404)
  return data as CouponRow
}

// ───────────────────────── Código aplicado desde el panel ─────────────────────────
//
// En AppleFix el código se canjea en la orden, lo aplica quien atiende. Acá es igual: la
// mayoría de las reservas se cargan a mano y nunca pasan por el panel del cliente, así que
// sin esto un referido que reserva por WhatsApp no tendría cómo usar su código.

export interface BookingCoupon {
  code: string
  origin: CouponOrigin
  discount: number
  amountBefore: number
  amountAfter: number
  appliedAt: string
}

async function bookingForCoupon(bookingId: string): Promise<Record<string, any>> {
  if (!UUID_RE.test(bookingId)) throw new CouponError('Reserva no encontrada.', 404)
  const { data: booking } = await supabaseAdmin.from('bookings').select('*').eq('id', bookingId).maybeSingle()
  if (!booking) throw new CouponError('Reserva no encontrada.', 404)
  return booking
}

/** El cupón o código de referido que tiene aplicada esta reserva, si tiene. */
export async function getBookingCoupon(bookingId: string): Promise<BookingCoupon | null> {
  const booking = await bookingForCoupon(bookingId)
  if (!booking.quote_id) return null
  const { data, error } = await supabaseAdmin
    .from('coupon_redemptions')
    .select('discount, amount_before, amount_after, created_at, coupon:coupons(code, origin)')
    .eq('quote_id', booking.quote_id)
    .maybeSingle()
  if (error || !data) return null
  const coupon: any = Array.isArray(data.coupon) ? data.coupon[0] : data.coupon
  if (!coupon) return null
  return {
    code: coupon.code,
    origin: coupon.origin,
    discount: data.discount,
    amountBefore: data.amount_before,
    amountAfter: data.amount_after,
    appliedAt: data.created_at,
  }
}

/**
 * Aplica un código a una reserva desde el panel: valida con las mismas reglas que el panel
 * del cliente, registra el uso y deja el precio de la reserva con el descuento (como un
 * reajuste, con su motivo). El precio original no se pisa.
 */
export async function applyCouponToBooking(bookingId: string, rawCode: unknown, actor: string): Promise<BookingCoupon> {
  const booking = await bookingForCoupon(bookingId)
  if (['cancelled', 'no_show'].includes(String(booking.status))) throw new CouponError('La reserva está cancelada.')
  if (!booking.quote_id) throw new CouponError('Esta reserva no tiene identificador de cotización.')

  let customerId: string | null = booking.customer_id || null
  if (!customerId && booking.client_email) {
    const { data: customer } = await supabaseAdmin
      .from('customers')
      .select('id')
      .eq('email', String(booking.client_email).trim().toLowerCase())
      .maybeSingle()
    customerId = customer?.id || null
  }
  if (!customerId) throw new CouponError('Esta reserva no está enlazada a una ficha de cliente: no se puede registrar el uso del código.')

  const { data: existing } = await supabaseAdmin.from('coupon_redemptions').select('id').eq('quote_id', booking.quote_id).maybeSingle()
  if (existing) throw new CouponError('Esta reserva ya tiene un código aplicado. Quítalo antes de poner otro.')

  const price = Math.round(Number(booking.adjusted_price) || Number(booking.original_price) || Number(booking.total_price) || 0)
  if (price <= 0) throw new CouponError('La reserva no tiene precio: ponle el valor antes de aplicar un código.')

  const quote = await quoteCoupon(rawCode, customerId, booking.quote_id, price)
  const { error: writeError } = await supabaseAdmin.from('coupon_redemptions').insert({
    coupon_id: quote.couponId,
    customer_id: customerId,
    quote_id: booking.quote_id,
    booking_id: booking.id,
    amount_before: price,
    discount: quote.discount,
    amount_after: quote.finalPrice,
  })
  if (writeError) throw writeError

  const { error: priceError } = await supabaseAdmin
    .from('bookings')
    .update({
      adjusted_price: quote.finalPrice,
      adjustment_comment: `Código ${quote.code}: ${quote.label} (−$${quote.discount.toLocaleString('es-CL')})`,
      adjusted_at: new Date().toISOString(),
      adjusted_by: actor,
    })
    .eq('id', booking.id)
  if (priceError) {
    // Sin el precio rebajado el uso no puede quedar registrado.
    await supabaseAdmin.from('coupon_redemptions').delete().eq('quote_id', booking.quote_id)
    throw priceError
  }
  return (await getBookingCoupon(bookingId))!
}

/** Quita el código de una reserva y le devuelve el precio que tenía antes. */
export async function removeCouponFromBooking(bookingId: string, actor: string): Promise<{ code: string; restoredPrice: number }> {
  const booking = await bookingForCoupon(bookingId)
  const { data: redemption } = await supabaseAdmin
    .from('coupon_redemptions')
    .select('id, amount_before, amount_after, reward_coupon_id, coupon:coupons(code)')
    .eq('quote_id', booking.quote_id)
    .maybeSingle()
  if (!redemption) throw new CouponError('Esta reserva no tiene un código aplicado.', 404)
  if (redemption.reward_coupon_id) throw new CouponError('Ese uso ya entregó un premio: no se puede quitar.')
  const { data: credited } = await supabaseAdmin.from('customer_credit_movements').select('id').eq('redemption_id', redemption.id).maybeSingle()
  if (credited) throw new CouponError('Ese referido ya entregó créditos a quien lo refirió: no se puede quitar.')

  const { error } = await supabaseAdmin.from('coupon_redemptions').delete().eq('id', redemption.id)
  if (error) throw error
  // Solo se devuelve el precio si sigue siendo el del descuento (nadie lo reajustó después).
  const current = Math.round(Number(booking.adjusted_price) || 0)
  const original = Math.round(Number(booking.original_price) || Number(booking.total_price) || 0)
  if (current === redemption.amount_after) {
    await supabaseAdmin
      .from('bookings')
      .update({
        adjusted_price: redemption.amount_before === original ? null : redemption.amount_before,
        adjustment_comment: redemption.amount_before === original ? null : 'Se quitó el código de descuento',
        adjusted_at: new Date().toISOString(),
        adjusted_by: actor,
      })
      .eq('id', booking.id)
  }
  const coupon: any = Array.isArray(redemption.coupon) ? redemption.coupon[0] : redemption.coupon
  return { code: coupon?.code || '', restoredPrice: redemption.amount_before }
}
