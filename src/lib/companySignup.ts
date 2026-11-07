/**
 * Registro de empresas por link (Tomás, 21-10-2026: «igual que el link de trabajadores, pero
 * para agregar empresas. Al registrarse debe redirigir de inmediato al inicio de sesión o
 * enviar un correo con el acceso»).
 *
 * Un link único, con o sin clave, que la oficina manda a la empresa. Quien lo abre registra la
 * empresa (razón social, RUT y datos de facturación) y sus datos; queda como ENCARGADO de esa
 * empresa, le llega el correo con el link de acceso a «Mi cuenta» y se le lleva al inicio de
 * sesión. No se puede sumar a una empresa que ya existe: eso lo hace la oficina en Empresas.
 *
 * El link vive en `app_settings` (clave 'company_signup', add_pendientes_oct.sql).
 */

import { randomBytes, randomInt, timingSafeEqual } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase'
import { CompanyError, parseCompanyInput } from '@/lib/companies'
import { isValidEmail } from '@/lib/emailFormat'
import { normalizeEmail } from '@/lib/emailLog'
import { notifyTeam } from '@/lib/teamNotices'
import { siteUrl } from '@/lib/siteUrl'

export interface CompanySignupLink {
  /** false = falta correr add_pendientes_oct.sql. */
  available: boolean
  token: string | null
  pin: string | null
  requirePin: boolean
}

export type CompanySignupAction = 'open' | 'rotate' | 'close' | 'require-pin' | 'no-pin'

const KEY = 'company_signup'
const newToken = () => randomBytes(18).toString('base64url')
const newPin = () => String(randomInt(0, 1_000_000)).padStart(6, '0')
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))

export async function getCompanySignupLink(): Promise<CompanySignupLink> {
  const { data, error } = await supabaseAdmin.from('app_settings').select('value').eq('key', KEY).maybeSingle()
  if (error) return { available: false, token: null, pin: null, requirePin: true }
  const v = (data?.value || {}) as Record<string, unknown>
  return {
    available: true,
    token: typeof v.token === 'string' ? v.token : null,
    pin: typeof v.pin === 'string' ? v.pin : null,
    requirePin: v.requirePin !== false,
  }
}

/** Mismas acciones que el link de trabajadores: abrir, cambiar, cerrar, pedir o no la clave. */
export async function updateCompanySignupLink(action: CompanySignupAction, actor: string): Promise<CompanySignupLink> {
  const link = await getCompanySignupLink()
  if (!link.available) throw new CompanyError('Falta correr la migración add_pendientes_oct.sql.', 409)
  const next =
    action === 'open'
      ? { token: link.token || newToken(), pin: link.pin || newPin(), requirePin: link.requirePin }
      : action === 'rotate'
        ? { token: newToken(), pin: newPin(), requirePin: link.requirePin }
        : action === 'close'
          ? { token: null, pin: link.pin, requirePin: link.requirePin }
          : { token: link.token, pin: link.pin || newPin(), requirePin: action === 'require-pin' }
  const { error } = await supabaseAdmin
    .from('app_settings')
    .upsert({ key: KEY, value: next, updated_by: actor, updated_at: new Date().toISOString() }, { onConflict: 'key' })
  if (error) throw new CompanyError('No se pudo guardar el link de registro.', 500)
  return getCompanySignupLink()
}

export async function checkCompanySignupToken(token: string): Promise<{ valid: boolean; requirePin: boolean }> {
  const link = await getCompanySignupLink()
  return { valid: Boolean(link.token && token && same(link.token, String(token))), requirePin: link.requirePin }
}

const text = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '')

/**
 * Registro desde el link. Body: `{ token, clave, razon_social, rut, giro?, direccion?,
 * comuna?, ciudad?, email_facturacion?, name, email, phone? }`. Crea la empresa y deja a la
 * persona como encargada. Devuelve el correo con que entra.
 */
export async function registerCompany(body: any): Promise<{ companyId: string; code: string; razonSocial: string; email: string }> {
  const link = await getCompanySignupLink()
  const token = String(body?.token || '')
  const clave = String(body?.clave || '').trim()
  if (!link.token || !same(link.token, token)) throw new CompanyError('Este link de registro ya no es válido. Pide uno nuevo a Yo Me Encargo.', 404)
  if (link.requirePin && (!link.pin || !same(link.pin, clave))) throw new CompanyError('La clave del link no es correcta.', 403)

  const company = parseCompanyInput({
    razon_social: body?.razon_social,
    rut: body?.rut,
    giro: body?.giro,
    direccion: body?.direccion,
    comuna: body?.comuna,
    ciudad: body?.ciudad,
    email_facturacion: body?.email_facturacion,
    facturacion_mensual: true,
  })
  const name = text(body?.name, 120)
  if (!name) throw new CompanyError('Escribe tu nombre.')
  if (!isValidEmail(body?.email)) throw new CompanyError('Revisa tu correo: con él vas a entrar a tu cuenta.')
  const email = normalizeEmail(body.email)
  const phone = text(body?.phone, 30) || null

  // Una persona que ya está en otra empresa no se cambia sola: lo hace la oficina.
  const { data: existing } = await supabaseAdmin.from('customers').select('id, company_id').eq('email', email).maybeSingle()
  if (existing?.company_id) {
    throw new CompanyError('Ese correo ya pertenece a una empresa registrada. Entra a tu cuenta o pídele a Yo Me Encargo que te agregue.', 409)
  }
  // Un correo que ya tiene reservas no se asocia solo: al asociarlo, sus reservas pasarían a la
  // empresa (trigger de auto-asignación) sin que nadie confirme que el correo es suyo.
  if (existing) {
    const { count } = await supabaseAdmin.from('bookings').select('id', { count: 'exact', head: true }).eq('customer_id', existing.id)
    if ((count || 0) > 0) {
      throw new CompanyError('Ese correo ya tiene servicios con nosotros. Pídele a Yo Me Encargo que registre la empresa y te asocie.', 409)
    }
  }
  // Un RUT que ya aparece en reservas o cotizaciones tampoco se registra por link: con él se
  // tomarían esas reservas. Lo registra la oficina, que sabe de quién es.
  const rut = String(company.rut)
  const [rutBody, dv] = rut.split('-')
  const dotted = rutBody.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  const forms = Array.from(new Set([rut, `${dotted}-${dv}`, `${rutBody}${dv}`, `${dotted}${dv}`]))
  const or = forms.map((f) => `company_rut.eq.${f}`).join(',')
  const [{ count: bookingsWithRut }, { count: quotesWithRut }] = await Promise.all([
    supabaseAdmin.from('bookings').select('id', { count: 'exact', head: true }).or(or),
    supabaseAdmin.from('quote_prospects').select('id', { count: 'exact', head: true }).or(or),
  ])
  if ((bookingsWithRut || 0) + (quotesWithRut || 0) > 0) {
    throw new CompanyError('Esa empresa ya tiene historial con nosotros. Pídele a Yo Me Encargo que la registre y te asocie.', 409)
  }

  const { data: created, error } = await supabaseAdmin.from('companies').insert(company).select('id, code, razon_social, rut').single()
  if (error || !created) {
    if (error?.code === '23505') {
      throw new CompanyError('Esa empresa ya está registrada. Pídele a Yo Me Encargo que te agregue como persona de la empresa.', 409)
    }
    throw new CompanyError('No pudimos registrar la empresa. Intenta de nuevo.', 500)
  }

  const person = {
    is_company: true,
    company_name: created.razon_social,
    company_rut: created.rut,
    company_id: created.id,
    company_role: 'encargado',
    updated_at: new Date().toISOString(),
  }
  const { error: personError } = existing
    ? await supabaseAdmin.from('customers').update(person).eq('id', existing.id)
    : await supabaseAdmin.from('customers').insert({ email, name, phone, ...person })
  if (personError) {
    // Sin la persona la empresa queda huérfana: se borra para que pueda volver a intentarlo.
    await supabaseAdmin.from('companies').delete().eq('id', created.id)
    throw new CompanyError('No pudimos registrar tus datos. Intenta de nuevo.', 500)
  }
  if (existing) {
    // Nombre y teléfono solo si no los tenía.
    const { data: c } = await supabaseAdmin.from('customers').select('name, phone').eq('id', existing.id).maybeSingle()
    const fill: Record<string, string> = {}
    if (!c?.name) fill.name = name
    if (!c?.phone && phone) fill.phone = phone
    if (Object.keys(fill).length) await supabaseAdmin.from('customers').update(fill).eq('id', existing.id)
  }

  await notifyTeam({
    label: 'empresa-registrada',
    key: `company-signup/${created.id}`,
    subject: `Empresa nueva registrada por link: ${created.razon_social}`,
    lines: [
      `${name} (${email}${phone ? `, ${phone}` : ''}) registro la empresa ${created.razon_social} (${created.code}) con el link de empresas.`,
      'Quedo como encargado de la cuenta. Revisa sus datos de facturacion y su tarifa en Empresas.',
      '',
      `Panel: ${siteUrl()}/admin`,
    ],
  })
  return { companyId: created.id, code: created.code, razonSocial: created.razon_social, email }
}
