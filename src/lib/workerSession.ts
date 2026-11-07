// Sesión del trabajador en `/trabajos` (RUT + PIN personal).
//
// Capa aparte de la sesión de admin, la del cliente y la de los links por camión: versión
// propia ('w1'), así un token de trabajador nunca valida como ninguna de las otras.
//
// La firma incluye el HASH DEL PIN del trabajador (que no viaja en la cookie). Dos efectos
// buscados: cambiarle el PIN desde el admin cierra todas sus sesiones abiertas, y validar
// una sesión obliga a leer al trabajador de la base, así que desactivarlo lo saca al tiro.

import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase'
import { UUID_RE, type Worker } from '@/lib/workers'

const TOKEN_VERSION = 'w1'
const TTL_MS = 30 * 24 * 60 * 60 * 1000

export const WORKER_SESSION_COOKIE = 'worker_session'
export const WORKER_SESSION_MAX_AGE = TTL_MS / 1000

function getSecret(): string {
  return process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_PASSWORD || ''
}

const encoder = new TextEncoder()

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function hmac(data: string, secret: string): Promise<string> {
  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signature = await globalThis.crypto.subtle.sign('HMAC', key, encoder.encode(data))
  return toBase64Url(new Uint8Array(signature))
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return mismatch === 0
}

export async function createWorkerSessionToken(workerId: string, pinHash: string): Promise<string> {
  const secret = getSecret()
  if (!secret) throw new Error('Falta ADMIN_SESSION_SECRET')
  const payload = `${TOKEN_VERSION}.${workerId}.${Date.now() + TTL_MS}`
  return `${payload}.${await hmac(`${payload}.${pinHash}`, secret)}`
}

/** El trabajador de la sesión, o null si no hay sesión válida o ya no está activo. */
export async function verifyWorkerSessionToken(token: string | undefined | null): Promise<Worker | null> {
  if (!token) return null
  const secret = getSecret()
  if (!secret) return null

  const parts = token.split('.')
  if (parts.length !== 4) return null
  const [version, workerId, expStr, signature] = parts
  if (version !== TOKEN_VERSION || !UUID_RE.test(workerId)) return null
  const exp = Number(expStr)
  if (!Number.isFinite(exp) || Date.now() > exp) return null

  const { data } = await supabaseAdmin
    .from('workers')
    .select('id, code, name, rut, phone, vehicle_id, active, created_at, pin_hash')
    .eq('id', workerId)
    .maybeSingle()
  if (!data || !data.active) return null

  const expected = await hmac(`${version}.${workerId}.${expStr}.${data.pin_hash}`, secret)
  if (!safeEqual(signature, expected)) return null

  const { pin_hash: _pinHash, ...worker } = data
  return worker as Worker
}

/** Para páginas y rutas del servidor: el trabajador de la cookie de esta petición. */
export async function getSessionWorker(): Promise<Worker | null> {
  return verifyWorkerSessionToken(cookies().get(WORKER_SESSION_COOKIE)?.value)
}
