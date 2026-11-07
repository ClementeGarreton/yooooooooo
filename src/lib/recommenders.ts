/**
 * Recomendadores (conserjes y otros): personas que no contratan servicios pero recomiendan a
 * Yo Me Encargo (Tomás, 23-10-2026: «debe ser como agregar un cliente y este cliente, sin
 * tener un trabajo, tenga su link/cupón de descuento para recomendación, que se comparta y
 * tener un tracking de uso y pago»).
 *
 * Es el mismo programa de referidos de los clientes, sin esperar a que la persona haya
 * contratado: se le crea la ficha de cliente y su código de referido al tiro. Desde ahí todo
 * es lo que ya existe:
 *   - quien llega con su código (o con su link) tiene el descuento del referido;
 *   - cuando ese servicio se paga, el recomendador gana sus créditos;
 *   - los retira por transferencia desde «Mi cuenta → Beneficios» y la oficina marca el
 *     retiro como pagado en Marketing.
 * Lo que se agrega acá es crearlo y el seguimiento por recomendador. Se reconoce por la
 * descripción de su código: «Recomendador · <dónde>» (sin migración).
 */

import { supabaseAdmin } from '@/lib/supabase'
import { CouponError, getOrCreateReferralCode } from '@/lib/coupons'
import { referralSteps } from '@/lib/referralCredits'
import { isValidEmail } from '@/lib/emailFormat'
import { normalizeEmail } from '@/lib/emailLog'
import { siteUrl } from '@/lib/siteUrl'

import { RECOMMENDER_PREFIX } from '@/lib/recommenderReward'
export { RECOMMENDER_PREFIX }

/** Link para compartir: abre el cotizador con el código ya cargado. */
export const recommenderLink = (code: string) => `${siteUrl()}/cotizador?start=online&codigo=${encodeURIComponent(code)}`

export interface Recommender {
  customerId: string
  customerCode: string
  name: string
  email: string
  phone: string | null
  /** Dónde está: edificio, condominio, oficina. */
  place: string | null
  code: string
  link: string
  active: boolean
  createdAt: string
  /** Cotizaciones que usaron su código. */
  uses: number
  /** De esas, las que ya se reservaron y pagaron. */
  paidUses: number
  /** Créditos ganados (1 crédito = $1). */
  earned: number
  /** Pagado por transferencia (retiros marcados «pagado»). */
  paidOut: number
  /** Retiro pedido y todavía no pagado. */
  requested: number
  /** Saldo que todavía no pide. */
  balance: number
}

const text = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '')

/** Crea (o reutiliza por correo) la ficha del recomendador y su código. Body: `{ name, email, phone?, place? }`. */
export async function createRecommender(body: any): Promise<{ customerId: string; code: string; link: string; name: string }> {
  const name = text(body?.name, 120)
  if (!name) throw new CouponError('Escribe el nombre.')
  if (!isValidEmail(body?.email)) throw new CouponError('Escribe un correo válido: con él entra a ver sus usos y pide sus pagos.')
  const email = normalizeEmail(body.email)
  const phone = text(body?.phone, 30) || null
  const place = text(body?.place, 120) || null

  const { data: existing } = await supabaseAdmin.from('customers').select('id, name, phone').eq('email', email).maybeSingle()
  let customerId = existing?.id as string | undefined
  if (!customerId) {
    const { data, error } = await supabaseAdmin.from('customers').insert({ email, name, phone }).select('id').single()
    if (error || !data) throw new CouponError('No se pudo crear la ficha.', 500)
    customerId = data.id
  } else {
    const fill: Record<string, string> = {}
    if (!existing?.name) fill.name = name
    if (!existing?.phone && phone) fill.phone = phone
    if (Object.keys(fill).length) await supabaseAdmin.from('customers').update(fill).eq('id', customerId)
  }

  const code = await getOrCreateReferralCode(customerId as string, 'always')
  if (!code) throw new CouponError('No se pudo crear el código. ¿Falta correr la migración de cupones?', 500)
  await supabaseAdmin
    .from('coupons')
    .update({ description: `${RECOMMENDER_PREFIX}${place ? ` · ${place}` : ''}` })
    .eq('owner_customer_id', customerId)
    .eq('origin', 'referido')
  return { customerId: customerId as string, code, link: recommenderLink(code), name }
}

/** Todos los recomendadores con su seguimiento: usos, pagados, créditos y pagos. */
export async function listRecommenders(): Promise<{ available: boolean; recommenders: Recommender[] }> {
  const { data: coupons, error } = await supabaseAdmin
    .from('coupons')
    .select('id, code, owner_customer_id, description, active, created_at')
    .eq('origin', 'referido')
    .ilike('description', `${RECOMMENDER_PREFIX}%`)
    .order('created_at', { ascending: false })
  if (error) return { available: false, recommenders: [] }
  const rows = (coupons || []) as any[]
  if (rows.length === 0) return { available: true, recommenders: [] }
  const ownerIds = rows.map((r) => r.owner_customer_id).filter(Boolean)
  const [{ data: customers }, steps, { data: movements }, { data: withdrawals }] = await Promise.all([
    supabaseAdmin.from('customers').select('id, code, name, email, phone').in('id', ownerIds),
    referralSteps(rows.map((r) => r.id)),
    supabaseAdmin.from('customer_credit_movements').select('customer_id, amount').in('customer_id', ownerIds),
    supabaseAdmin.from('credit_withdrawals').select('customer_id, amount, status').in('customer_id', ownerIds),
  ])
  const byId = new Map(((customers || []) as any[]).map((c) => [c.id, c]))
  return {
    available: true,
    recommenders: rows.map((r) => {
      const c = byId.get(r.owner_customer_id) || {}
      const mine = steps.filter((s) => s.couponId === r.id)
      const moves = ((movements || []) as any[]).filter((m) => m.customer_id === r.owner_customer_id)
      const outs = ((withdrawals || []) as any[]).filter((w) => w.customer_id === r.owner_customer_id)
      const sum = (xs: any[]) => xs.reduce((acc, x) => acc + (Number(x.amount) || 0), 0)
      return {
        customerId: r.owner_customer_id,
        customerCode: c.code || '',
        name: c.name || c.email || 'Sin nombre',
        email: c.email || '',
        phone: c.phone || null,
        place: String(r.description || '').split(' · ').slice(1).join(' · ') || null,
        code: r.code,
        link: recommenderLink(r.code),
        active: r.active !== false,
        createdAt: r.created_at,
        uses: mine.length,
        paidUses: mine.filter((s) => s.paid).length,
        earned: sum(moves.filter((m) => Number(m.amount) > 0)),
        paidOut: sum(outs.filter((w) => w.status === 'pagado')),
        requested: sum(outs.filter((w) => w.status === 'solicitado')),
        balance: sum(moves),
      }
    }),
  }
}
