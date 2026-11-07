/**
 * Trabajadores con acceso individual (etapa 2 del panel de perfiles).
 *
 * Cada trabajador entra a `/trabajos` con su RUT y un PIN personal que le crea el admin en
 * la pestaña Flota. Reemplaza de a poco al PIN compartido por camión: los links por camión
 * siguen funcionando para no dejar a nadie afuera el día del cambio.
 *
 * El PIN nunca se guarda ni se devuelve en claro: solo su hash PBKDF2 (passwordHash.ts).
 */

import { supabaseAdmin } from '@/lib/supabase'
import { isValidRut, normalizeRut } from '@/lib/rut'
import { isValidEmail } from '@/lib/emailFormat'
import { isFieldRole, isWorkerRole, type WorkerRole } from '@/lib/workerRoles'

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface Worker {
  id: string
  code: string
  name: string
  rut: string
  phone: string | null
  /** Para los avisos por correo. Columna de add_worker_email.sql: NO va en WORKER_FIELDS. */
  email?: string | null
  /** Tipo (add_tipo_trabajador.sql). Columna aparte de WORKER_FIELDS, como el correo. */
  role?: WorkerRole
  /** Camión habitual: sus trabajos le aparecen sin tener que asignarlo uno por uno. */
  vehicle_id: number | null
  active: boolean
  created_at: string
}

/** Sin `pin_hash`: ese campo no sale del servidor. */
export const WORKER_FIELDS = 'id, code, name, rut, phone, vehicle_id, active, created_at'

export class WorkerError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message)
    this.name = 'WorkerError'
  }
}

/**
 * PIN personal: 6 a 8 dígitos. Son 6 y no 4 porque acá el PIN es la única barrera (no hay
 * un link secreto delante, como en los links por camión) y lo que protege son nombres,
 * teléfonos y direcciones de clientes.
 */
export const WORKER_PIN_RE = /^\d{6,8}$/
export const WORKER_PIN_HELP = 'El PIN debe tener entre 6 y 8 dígitos.'

/** Campos editables de un trabajador, validados. `partial` = solo los que vienen (PATCH). */
export function parseWorkerInput(body: any, partial = false): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const has = (key: string) => !partial || body?.[key] !== undefined

  if (has('name')) {
    const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 120) : ''
    if (!name) throw new WorkerError('Falta el nombre.')
    out.name = name
  }
  if (has('rut')) {
    if (!isValidRut(body?.rut)) throw new WorkerError('El RUT no es válido. Revisa el dígito verificador.')
    out.rut = normalizeRut(body.rut)
  }
  if (has('phone')) {
    out.phone = typeof body?.phone === 'string' && body.phone.trim() ? body.phone.trim().slice(0, 30) : null
  }
  if (has('vehicle_id')) {
    const id = Number(body?.vehicle_id)
    out.vehicle_id = body?.vehicle_id === null || body?.vehicle_id === '' || !Number.isInteger(id) ? null : id
  }
  if (partial && body?.active !== undefined) out.active = body.active === true
  return out
}

/** Trabajadores asignados a cada reserva, de una sola consulta. */
export async function getAssignedWorkerIds(bookingId: string): Promise<string[]> {
  const { data } = await supabaseAdmin.from('booking_workers').select('worker_id').eq('booking_id', bookingId)
  return (data || []).map((r) => r.worker_id)
}

// ───────────────────────── Correo (add_worker_email.sql) ─────────────────────────
//
// El correo se lee y se escribe APARTE de WORKER_FIELDS a propósito: esa lista la usan el
// ingreso y la agenda del trabajador, y una columna que todavía no existe en la base los
// botaría. Acá, si la migración no está corrida, simplemente no hay correos.

/** `undefined` = no vino en el body; `null` = borrar. Lanza si el correo no es válido. */
export function parseWorkerEmail(body: any): string | null | undefined {
  if (body?.email === undefined) return undefined
  const value = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!value) return null
  if (!isValidEmail(value)) throw new WorkerError('El correo no es válido.')
  return value.slice(0, 200)
}

/** id → correo. Vacío si la columna no existe. */
export async function getWorkerEmails(): Promise<Map<string, string | null>> {
  const { data, error } = await supabaseAdmin.from('workers').select('id, email')
  if (error) return new Map()
  return new Map(((data || []) as unknown as { id: string; email: string | null }[]).map((w) => [w.id, w.email]))
}

/** Guarda el correo. Lanza un WorkerError legible si falta la migración. */
export async function saveWorkerEmail(workerId: string, email: string | null): Promise<void> {
  const { error } = await supabaseAdmin.from('workers').update({ email }).eq('id', workerId)
  if (error) {
    console.error('[workers] No se pudo guardar el correo:', error.message)
    throw new WorkerError(
      'Lo demás se guardó, pero el correo no: falta correr la migración add_worker_email.sql.',
      409
    )
  }
}

// ───────────────────────── Tipo (add_tipo_trabajador.sql) ─────────────────────────
//
// Igual que el correo: se lee y se escribe aparte de WORKER_FIELDS, para que el ingreso y la
// agenda del trabajador no se caigan si la migración todavía no está corrida. Sin ella, todos
// son de terreno, como hasta hoy.

/** `undefined` = no vino en el body. Lanza si el tipo no existe. */
export function parseWorkerRole(body: any): WorkerRole | undefined {
  if (body?.role === undefined) return undefined
  if (!isWorkerRole(body.role)) throw new WorkerError('Elige el tipo de trabajador.')
  return body.role
}

/** id → tipo. Vacío si la columna no existe (todos de terreno). */
export async function getWorkerRoles(): Promise<Map<string, WorkerRole>> {
  const { data, error } = await supabaseAdmin.from('workers').select('id, role')
  if (error) return new Map()
  return new Map(((data || []) as unknown as { id: string; role: WorkerRole }[]).map((w) => [w.id, w.role]))
}

/** Guarda el tipo. Uno que no es de terreno queda sin camión habitual. */
export async function saveWorkerRole(workerId: string, role: WorkerRole): Promise<void> {
  const update: Record<string, unknown> = { role }
  if (!isFieldRole(role)) update.vehicle_id = null
  const { error } = await supabaseAdmin.from('workers').update(update).eq('id', workerId)
  if (error) {
    console.error('[workers] No se pudo guardar el tipo:', error.message)
    throw new WorkerError('Lo demás se guardó, pero la categoría no: falta correr la migración add_categorias_trabajador.sql.', 409)
  }
}

/**
 * Solo los de terreno (choferes y peonetas): para armar cuadrillas y elegir quién va a un
 * trabajo. Administrativos, contador y externos no van a terreno. Los que ya están en `keep` (p. ej. la cuadrilla
 * actual de una reserva) se dejan, para no esconder una asignación hecha antes.
 */
export async function onlyFieldWorkers<T extends { id: string }>(workers: T[], keep: string[] = []): Promise<T[]> {
  const roles = await getWorkerRoles()
  return workers.filter((w) => keep.includes(w.id) || isFieldRole(roles.get(w.id)))
}
