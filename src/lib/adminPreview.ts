// «Ver como»: el admin abre el panel de un cliente o de un trabajador tal como lo ve esa
// persona, en SOLO LECTURA.
//
// No se le presta la sesión de la persona. Es una cookie aparte (`admin_preview`), con su
// propia versión firmada, que:
//   - dura 30 minutos;
//   - solo la entrega una ruta del admin, y al leerla se exige además una sesión de admin
//     viva en el mismo navegador (sin ella, la cookie sola no abre nada);
//   - sirve ÚNICAMENTE para pintar las páginas. Mientras esté presente, el middleware
//     rechaza toda llamada a /api/cuenta y /api/trabajos: desde la vista no se paga, no se
//     reprograma, no se sube ni se registra nada, ni a nombre de la persona ni del admin.
//
// Este archivo no importa nada de servidor (ni next/headers ni Supabase) para que el
// middleware pueda usar el nombre de la cookie.

const TOKEN_VERSION = 'pv1'
const TTL_MS = 30 * 60 * 1000

export const ADMIN_PREVIEW_COOKIE = 'admin_preview'
export const ADMIN_PREVIEW_MAX_AGE = TTL_MS / 1000

export type PreviewKind = 'customer' | 'worker'

export interface AdminPreview {
  kind: PreviewKind
  /** customers.id o workers.id */
  id: string
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const encoder = new TextEncoder()

function getSecret(): string {
  return process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_PASSWORD || ''
}

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

export async function createPreviewToken(kind: PreviewKind, id: string): Promise<string> {
  const secret = getSecret()
  if (!secret) throw new Error('Falta ADMIN_SESSION_SECRET')
  if (!UUID_RE.test(id)) throw new Error('id inválido')
  const payload = `${TOKEN_VERSION}.${kind}.${id}.${Date.now() + TTL_MS}`
  return `${payload}.${await hmac(payload, secret)}`
}

/** Firma y vencimiento de la cookie. Que haya además sesión de admin lo exige quien la usa. */
export async function verifyPreviewToken(token: string | undefined | null): Promise<AdminPreview | null> {
  if (!token) return null
  const secret = getSecret()
  if (!secret) return null
  const parts = token.split('.')
  if (parts.length !== 5) return null
  const [version, kind, id, expStr, signature] = parts
  if (version !== TOKEN_VERSION || (kind !== 'customer' && kind !== 'worker') || !UUID_RE.test(id)) return null
  const exp = Number(expStr)
  if (!Number.isFinite(exp) || Date.now() > exp) return null
  const expected = await hmac(`${version}.${kind}.${id}.${expStr}`, secret)
  return safeEqual(signature, expected) ? { kind, id } : null
}
