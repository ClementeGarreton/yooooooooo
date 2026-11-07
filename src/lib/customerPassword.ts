/**
 * Clave de acceso del Panel del Cliente (rediseño del admin, fase 3).
 *
 * Tres formas de entrar, de la más común a la de respaldo:
 *   1. Correo + clave propia.
 *   2. PRIMERA VEZ: correo + RUT + la clave que quiere usar. Solo funciona mientras la
 *      cuenta no tenga clave, y solo con el RUT CONFIRMADO por el equipo (`customers.rut`).
 *      Apenas crea la clave, el RUT deja de abrir la cuenta.
 *   3. Link de un solo uso al correo (customerLogin.ts): para quien no tiene RUT
 *      confirmado y para recuperar la clave (entra por el link y crea una nueva).
 *
 * Por qué el RUT del cotizador NO sirve para entrar: cualquiera puede cotizar con el
 * correo de otra persona y escribir un RUT que conoce; si eso bastara, después entraría a
 * la cuenta ajena. Ese RUT se guarda como `rut_declared` y recién vale cuando alguien del
 * panel lo confirma en la ficha del cliente.
 *
 * Los errores de entrada son siempre el mismo mensaje, exista o no el correo.
 */

import { supabaseAdmin } from '@/lib/supabase'
import { hashPassword, validatePasswordStrength, verifyPassword } from '@/lib/passwordHash'
import { isValidRut, normalizeRut } from '@/lib/rut'

const normalizeEmail = (value: unknown) => (typeof value === 'string' ? value.trim().toLowerCase() : '')

// Hash de relleno: cuando el correo no existe o no tiene clave se verifica igual contra
// esto, para que la respuesta tarde lo mismo y no revele qué correos son clientes.
let dummyHash: Promise<string> | null = null
const getDummyHash = () => (dummyHash = dummyHash || hashPassword('relleno-sin-uso'))

/** customer_id si el correo y la clave calzan; si no, null. */
export async function loginWithPassword(rawEmail: unknown, password: unknown): Promise<string | null> {
  const email = normalizeEmail(rawEmail)
  const pass = typeof password === 'string' ? password : ''
  const { data } = email
    ? await supabaseAdmin.from('customers').select('id, password_hash').eq('email', email).maybeSingle()
    : { data: null }
  const ok = await verifyPassword(pass, data?.password_hash || (await getDummyHash()))
  return data?.password_hash && ok ? data.id : null
}

export type FirstTimeResult =
  | { ok: true; customerId: string }
  /** `weak` = la clave nueva no cumple; `invalid` = cualquier otro motivo (no se dice cuál). */
  | { ok: false; reason: 'weak' | 'invalid'; message: string }

/**
 * Primera vez: correo + RUT confirmado + clave nueva, en un solo paso. La condición
 * «todavía sin clave» va también en el UPDATE: si dos intentos llegan a la vez, uno solo
 * crea la clave.
 */
export async function firstTimeWithRut(rawEmail: unknown, rawRut: unknown, newPassword: unknown): Promise<FirstTimeResult> {
  const invalid: FirstTimeResult = {
    ok: false,
    reason: 'invalid',
    message: 'No pudimos crear tu clave con esos datos. Revisa el correo y el RUT, o pide un link de acceso a tu correo.',
  }
  const pass = typeof newPassword === 'string' ? newPassword : ''
  const weak = validatePasswordStrength(pass)
  if (weak) return { ok: false, reason: 'weak', message: weak }

  const email = normalizeEmail(rawEmail)
  if (!email || !isValidRut(rawRut)) return invalid
  const rut = normalizeRut(rawRut)

  const { data: customer } = await supabaseAdmin
    .from('customers')
    .select('id, rut, password_hash')
    .eq('email', email)
    .maybeSingle()
  if (!customer || !customer.rut || customer.password_hash || normalizeRut(customer.rut) !== rut) {
    // Mismo trabajo que el camino feliz, para que el tiempo de respuesta no distinga.
    await hashPassword(pass)
    return invalid
  }

  const { data: updated } = await supabaseAdmin
    .from('customers')
    .update({ password_hash: await hashPassword(pass), password_set_at: new Date().toISOString() })
    .eq('id', customer.id)
    .is('password_hash', null)
    .select('id')
    .maybeSingle()
  return updated ? { ok: true, customerId: updated.id } : invalid
}

/** Crea o cambia la clave de un cliente que YA tiene sesión (entró con su clave o por el link). */
export async function setCustomerPassword(customerId: string, newPassword: unknown): Promise<string | null> {
  const pass = typeof newPassword === 'string' ? newPassword : ''
  const weak = validatePasswordStrength(pass)
  if (weak) return weak
  const { error } = await supabaseAdmin
    .from('customers')
    .update({ password_hash: await hashPassword(pass), password_set_at: new Date().toISOString() })
    .eq('id', customerId)
  if (error) {
    console.error('[customerPassword] Error guardando la clave:', error)
    return 'No pudimos guardar tu clave. Intenta de nuevo.'
  }
  return null
}

/** ¿Tiene clave creada? Sin la migración (columna inexistente) devuelve null. */
export async function customerHasPassword(customerId: string): Promise<boolean | null> {
  const { data, error } = await supabaseAdmin.from('customers').select('password_set_at, password_hash').eq('id', customerId).maybeSingle()
  if (error || !data) return null
  return Boolean(data.password_hash)
}

/**
 * Guarda el RUT que la persona escribió en el cotizador, como DECLARADO. Nunca pisa uno
 * ya declarado ni toca el confirmado. No lanza: cotizar no puede fallar por esto.
 */
export async function saveDeclaredRut(rawEmail: unknown, rawRut: unknown): Promise<void> {
  try {
    const email = normalizeEmail(rawEmail)
    if (!email || !isValidRut(rawRut)) return
    await supabaseAdmin.from('customers').update({ rut_declared: normalizeRut(rawRut) }).eq('email', email).is('rut_declared', null)
  } catch (error) {
    console.error('[customerPassword] No se pudo guardar el RUT declarado:', error)
  }
}
