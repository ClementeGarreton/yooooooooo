/**
 * Registro de trabajadores por link (Tomás, 15-10-2026): en vez de que la oficina cree a cada
 * persona, Tomás manda UN link único, con o sin clave (como los links por camión). La persona
 * se registra con sus datos, su PIN y sus datos bancarios, y queda PENDIENTE: no puede entrar
 * a /trabajos hasta que la oficina la apruebe en «Por aprobar → Trabajadores nuevos».
 *
 * El link y la clave viven en `fleet_config` y solo salen por rutas de admin. El link se crea
 * una vez y no cambia al poner o sacar la clave; cambiarlo (si se filtró) invalida el anterior,
 * y cerrarlo apaga el registro.
 */

import { randomBytes, randomInt, timingSafeEqual } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase'
import { hashPassword } from '@/lib/passwordHash'
import { WORKER_PIN_HELP, WORKER_PIN_RE, WorkerError, parseWorkerEmail, parseWorkerInput } from '@/lib/workers'
import { accountNumber, accountType } from '@/lib/workerPay'

export interface SignupLink {
  /** false = falta correr add_registro_trabajadores.sql. */
  available: boolean
  token: string | null
  pin: string | null
  /** true = además del link hay que escribir la clave. */
  requirePin: boolean
}

export interface PendingWorker {
  id: string
  code: string
  name: string
  rut: string
  phone: string | null
  email: string | null
  signedUpAt: string | null
  hasBankData: boolean
}

async function fleetRow(): Promise<any> {
  const { data } = await supabaseAdmin.from('fleet_config').select('*').single()
  return data
}

export async function getSignupLink(): Promise<SignupLink> {
  const row = await fleetRow()
  if (!row || !('worker_signup_token' in row)) return { available: false, token: null, pin: null, requirePin: true }
  return {
    available: true,
    token: row.worker_signup_token || null,
    pin: row.worker_signup_pin || null,
    requirePin: row.worker_signup_require_pin !== false,
  }
}

export type SignupLinkAction = 'open' | 'rotate' | 'close' | 'require-pin' | 'no-pin'

const newToken = () => randomBytes(18).toString('base64url')
const newPin = () => String(randomInt(0, 1_000_000)).padStart(6, '0')

/**
 * - 'open': abre el registro. Si ya hay link, se mantiene el mismo (es uno solo para todos).
 * - 'rotate': link y clave nuevos; el anterior deja de servir (para cuando se filtró).
 * - 'close': cierra el registro (el link deja de servir).
 * - 'require-pin' / 'no-pin': pide o no la clave, sin cambiar el link.
 */
export async function updateSignupLink(action: SignupLinkAction): Promise<SignupLink> {
  const row = await fleetRow()
  if (!row || !('worker_signup_token' in row)) throw new WorkerError('Falta correr la migración add_registro_trabajadores.sql.', 409)
  const update: Record<string, unknown> =
    action === 'open'
      ? { worker_signup_token: row.worker_signup_token || newToken(), worker_signup_pin: row.worker_signup_pin || newPin() }
      : action === 'rotate'
        ? { worker_signup_token: newToken(), worker_signup_pin: newPin() }
        : action === 'close'
          ? { worker_signup_token: null }
          : { worker_signup_require_pin: action === 'require-pin', worker_signup_pin: row.worker_signup_pin || newPin() }
  const { error } = await supabaseAdmin.from('fleet_config').update(update).eq('id', row.id)
  if (error) throw new WorkerError('No se pudo guardar el link de registro.', 500)
  return getSignupLink()
}

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))

/** ¿El token de la URL es el link de registro vigente? Y, si lo es, ¿pide clave? */
export async function checkSignupToken(token: string): Promise<{ valid: boolean; requirePin: boolean }> {
  const link = await getSignupLink()
  return { valid: Boolean(link.token && token && same(link.token, String(token))), requirePin: link.requirePin }
}

/**
 * Registro desde el link. Body: `{ token, clave, name, rut, phone, email, pin, pinRepeat,
 * bankCode?, bankAccountType?, bankAccountNumber? }`. Crea al trabajador inactivo y pendiente.
 */
export async function registerWorker(body: any): Promise<{ id: string; name: string; code: string }> {
  const link = await getSignupLink()
  const token = String(body?.token || '')
  const clave = String(body?.clave || '').trim()
  if (!link.token || !same(link.token, token)) throw new WorkerError('Este link de registro ya no es válido. Pide uno nuevo en la oficina.', 404)
  if (link.requirePin && (!link.pin || !same(link.pin, clave))) throw new WorkerError('La clave del link no es correcta.', 403)

  const input = parseWorkerInput({ name: body?.name, rut: body?.rut, phone: body?.phone })
  if (!input.phone) throw new WorkerError('Falta tu teléfono.')
  const email = parseWorkerEmail({ email: body?.email ?? '' })
  if (!email) throw new WorkerError('Falta tu correo.')
  const pin = String(body?.pin || '').trim()
  if (!WORKER_PIN_RE.test(pin)) throw new WorkerError(WORKER_PIN_HELP)
  if (pin !== String(body?.pinRepeat || '').trim()) throw new WorkerError('Los dos PIN no son iguales.')

  // Datos bancarios: opcionales al registrarse, pero si vienen, completos y válidos.
  const code = body?.bankCode === null || body?.bankCode === undefined || body?.bankCode === '' ? null : Math.round(Number(body.bankCode))
  if (code !== null && (!Number.isFinite(code) || code <= 0 || code > 9999)) throw new WorkerError('Elige tu banco.')
  const type = accountType(body?.bankAccountType || null)
  const number = accountNumber(body?.bankAccountNumber, 'cuenta')
  const bankParts = [code, type, number].filter((v) => v !== null).length
  if (bankParts > 0 && bankParts < 3) throw new WorkerError('Para tus datos bancarios completa banco, tipo y número de cuenta (o deja los tres vacíos).')

  const { data, error } = await supabaseAdmin
    .from('workers')
    .insert({ ...input, active: false, approval_status: 'pendiente', signed_up_at: new Date().toISOString(), pin_hash: await hashPassword(pin) })
    .select('id, name, code')
    .single()
  if (error || !data) {
    if (error?.code === '23505') throw new WorkerError('Ya hay un trabajador registrado con ese RUT. Si eres tú, pide tu PIN en la oficina.', 409)
    throw new WorkerError('No pudimos registrarte. Intenta de nuevo.', 500)
  }
  // Correo y banco van aparte: son columnas de migraciones posteriores.
  await supabaseAdmin.from('workers').update({ email }).eq('id', data.id)
  if (bankParts === 3) {
    await supabaseAdmin.from('workers').update({ bank_code: code, bank_account_type: type, bank_account_number: number }).eq('id', data.id)
  }
  return data
}

export async function getPendingWorkers(): Promise<PendingWorker[]> {
  const { data, error } = await supabaseAdmin.from('workers').select('*').eq('approval_status', 'pendiente').order('signed_up_at', { ascending: true })
  if (error) return []
  return ((data || []) as any[]).map((w) => ({
    id: w.id,
    code: w.code,
    name: w.name,
    rut: w.rut,
    phone: w.phone ?? null,
    email: w.email ?? null,
    signedUpAt: w.signed_up_at ?? null,
    hasBankData: Boolean(w.bank_code && w.bank_account_type && w.bank_account_number),
  }))
}

/** Aprueba (queda activo, puede entrar) o rechaza (queda inactivo) a alguien pendiente. */
export async function decideSignup(workerId: string, approve: boolean, vehicleId: number | null): Promise<{ name: string; code: string }> {
  const { data: worker } = await supabaseAdmin.from('workers').select('*').eq('id', workerId).maybeSingle()
  if (!worker || worker.approval_status !== 'pendiente') throw new WorkerError('Esa persona ya no está pendiente.', 409)
  const update = approve
    ? { approval_status: null, active: true, ...(vehicleId !== null ? { vehicle_id: vehicleId } : {}) }
    : { approval_status: 'rechazado', active: false }
  const { error } = await supabaseAdmin.from('workers').update(update).eq('id', workerId).eq('approval_status', 'pendiente')
  if (error) throw new WorkerError('No se pudo guardar.', 500)
  return { name: worker.name, code: worker.code }
}

// ───────────────────────── «Mis datos» del trabajador ─────────────────────────

export interface WorkerOwnData {
  name: string
  rut: string
  phone: string | null
  email: string | null
  bankCode: number | null
  bankAccountType: 'CCT' | 'CTV' | null
  bankAccountNumber: string | null
  /** false = falta add_nomina_y_pago_por_trabajo.sql: no hay dónde guardar el banco. */
  bankAvailable: boolean
}

export async function getWorkerOwnData(workerId: string): Promise<WorkerOwnData | null> {
  const { data: w } = await supabaseAdmin.from('workers').select('*').eq('id', workerId).maybeSingle()
  if (!w) return null
  return {
    name: w.name,
    rut: w.rut,
    phone: w.phone ?? null,
    email: w.email ?? null,
    bankCode: typeof w.bank_code === 'number' ? w.bank_code : null,
    bankAccountType: w.bank_account_type === 'CCT' || w.bank_account_type === 'CTV' ? w.bank_account_type : null,
    bankAccountNumber: w.bank_account_number ?? null,
    bankAvailable: 'bank_code' in w,
  }
}

/**
 * El trabajador cambia su teléfono, correo y datos bancarios. El nombre y el RUT no: los
 * corrige la oficina. Devuelve qué cambió (el número de cuenta, sin el número).
 */
export async function updateWorkerOwnData(workerId: string, body: any): Promise<{ name: string; changes: Record<string, { from: string; to: string }> }> {
  const { data: w } = await supabaseAdmin.from('workers').select('*').eq('id', workerId).maybeSingle()
  if (!w) throw new WorkerError('No encontramos tu ficha.', 404)
  const update: Record<string, unknown> = {}
  if ('phone' in body) {
    const phone = typeof body.phone === 'string' ? body.phone.trim().slice(0, 30) : ''
    if (!phone) throw new WorkerError('Falta tu teléfono.')
    update.phone = phone
  }
  if ('email' in body) {
    const email = parseWorkerEmail({ email: body.email ?? '' })
    if (!email) throw new WorkerError('Falta tu correo.')
    update.email = email
  }
  if ('bankCode' in body || 'bankAccountType' in body || 'bankAccountNumber' in body) {
    if (!('bank_code' in w)) throw new WorkerError('Todavía no se pueden guardar datos bancarios. Avísale a la oficina.', 409)
    const code = body.bankCode === null || body.bankCode === '' || body.bankCode === undefined ? null : Math.round(Number(body.bankCode))
    if (code === null || !Number.isFinite(code) || code <= 0 || code > 9999) throw new WorkerError('Elige tu banco.')
    const type = accountType(body.bankAccountType || null)
    if (!type) throw new WorkerError('Elige el tipo de cuenta.')
    const number = accountNumber(body.bankAccountNumber, 'cuenta')
    if (!number) throw new WorkerError('Escribe el número de cuenta.')
    Object.assign(update, { bank_code: code, bank_account_type: type, bank_account_number: number })
  }
  const labels: Record<string, string> = { phone: 'teléfono', email: 'correo', bank_code: 'banco', bank_account_type: 'tipo de cuenta', bank_account_number: 'número de cuenta' }
  const changes: Record<string, { from: string; to: string }> = {}
  for (const [key, value] of Object.entries(update)) {
    if (String(w[key] ?? '') === String(value ?? '')) continue
    changes[labels[key]] = key === 'bank_account_number' ? { from: w[key] ? 'cargado' : '—', to: 'nuevo' } : { from: String(w[key] ?? '—'), to: String(value ?? '—') }
  }
  if (Object.keys(changes).length === 0) return { name: w.name, changes }
  const { error } = await supabaseAdmin.from('workers').update(update).eq('id', workerId)
  if (error) throw new WorkerError('No pudimos guardar tus datos. Intenta de nuevo.', 500)
  return { name: w.name, changes }
}
