// Sesión del Panel del Cliente (/mi-cuenta).
//
// Tercera capa de sesión, aparte de la de admin (`adminSession.ts`) y la de choferes
// (`driverSession.ts`), con el mismo criterio que separó esas dos: el payload firmado
// lleva su propia versión ('c1'), así que el HMAC es distinto y una cookie de cliente
// NUNCA valida como sesión de admin ni de chofer aunque alguien la copie.
//
// La sesión va ATADA AL customer_id dentro del payload firmado. De ahí sale TODO lo que
// la persona puede ver: el panel filtra cada consulta por ese id en el servidor, nunca
// por un parámetro que venga del navegador.

const TOKEN_VERSION = 'c1'
// 30 días, igual que la de choferes: el cliente no se muda seguido y pedir un link
// nuevo cada vez que vuelve a mirar su reserva sería fricción pura.
export const CUSTOMER_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

export const CUSTOMER_SESSION_COOKIE = 'customer_session'

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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Firma una sesión para un cliente. El customer_id va DENTRO de lo firmado. */
export async function createCustomerSessionToken(
  customerId: string,
  ttlMs: number = CUSTOMER_SESSION_TTL_MS
): Promise<string> {
  if (!UUID_RE.test(customerId)) throw new Error('customer_id inválido')
  const secret = getSecret()
  if (!secret) throw new Error('Falta ADMIN_SESSION_SECRET para firmar la sesión')
  const exp = Date.now() + ttlMs
  const payload = `${TOKEN_VERSION}.${customerId}.${exp}`
  const signature = await hmac(payload, secret)
  return `${payload}.${signature}`
}

/**
 * Valida la cookie y devuelve el customer_id que firmó, o null. Es la ÚNICA fuente de
 * identidad del panel: si esto devuelve null, la persona no ve nada.
 */
export async function verifyCustomerSessionToken(
  token: string | undefined | null
): Promise<string | null> {
  if (!token) return null
  const secret = getSecret()
  if (!secret) return null

  const parts = token.split('.')
  if (parts.length !== 4) return null

  const [version, customerId, expStr, signature] = parts
  if (version !== TOKEN_VERSION) return null
  if (!UUID_RE.test(customerId)) return null

  const exp = Number(expStr)
  if (!Number.isFinite(exp) || Date.now() > exp) return null

  const expected = await hmac(`${version}.${customerId}.${expStr}`, secret)
  return safeEqual(signature, expected) ? customerId : null
}

/** customer_id de la sesión de una petición a la API, o null. */
export function customerIdFromRequest(request: {
  cookies: { get(name: string): { value: string } | undefined }
}): Promise<string | null> {
  return verifyCustomerSessionToken(request.cookies.get(CUSTOMER_SESSION_COOKIE)?.value)
}
