// Sesión del panel público de choferes (/trabajos/[token]), protegida por PIN.
//
// Es una capa aparte de la sesión de admin (`adminSession.ts`) A PROPÓSITO: el payload
// firmado lleva su propia versión en vez de "v1", así el HMAC resultante es distinto y un
// token de chofer NUNCA valida como sesión de administrador aunque alguien lo copie a la
// cookie `admin_authenticated`.
//
// La sesión va ATADA A UN SCOPE ('all' para el link general, 'v<id>' para el link de un
// camión). Sin eso, un chofer que entra con su PIN se lleva una cookie que abre el link
// de cualquier otro camión, y los links por camión no separarían nada.
//
// El salto d1 → d2 invalida las sesiones abiertas: la primera vez que entren después del
// deploy, los choferes tienen que volver a poner el PIN. Una vez.

const TOKEN_VERSION = 'd2'
// 30 días. Eran 12 h —una jornada— y en la práctica el chofer tenía que pedirle la clave
// al panel casi todos los días, así que compartir el acceso nunca terminaba de resolverse.
// El link sigue siendo revocable en cualquier momento: regenerarlo corta la sesión, porque
// el token de la URL deja de existir.
const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000

export const DRIVER_SESSION_COOKIE = 'driver_access'

/**
 * Cookie por scope: `driver_access_v2`, `driver_access_all`…
 *
 * Una sola cookie compartida haría que abrir el link de otro camión pisara la sesión
 * del propio, y el chofer tendría que reingresar el PIN cada vez que alterna. Con una
 * por camión, cada link recuerda su sesión por su cuenta.
 */
export function driverSessionCookieName(scope: string): string {
  return `${DRIVER_SESSION_COOKIE}_${scope}`
}

function getSecret(): string {
  return process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_PASSWORD || ''
}

/** PIN para entrar al panel de choferes. Configurable por env. */
export function getDriverPin(): string {
  return process.env.DRIVER_PIN || '2026'
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

/**
 * Compara el PIN en tiempo constante para no filtrar dígitos por timing.
 * El esperado se pasa por parámetro porque ahora cada camión tiene el suyo
 * (ver `effectiveVehiclePin` en driverAccess.ts); sin argumento cae al general.
 */
export function isValidDriverPin(candidate: string, expectedPin?: string): boolean {
  const expected = (expectedPin ?? getDriverPin()).trim()
  const a = String(candidate || '').trim()
  if (!expected) return false
  if (a.length !== expected.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ expected.charCodeAt(i)
  return mismatch === 0
}

/**
 * Firma una sesión para un scope concreto ('all' o 'v<id>'). El scope va DENTRO del
 * payload firmado, así que no se puede cambiar sin romper la firma.
 */
export async function createDriverSessionToken(
  scope: string,
  ttlMs: number = DEFAULT_TTL_MS
): Promise<string> {
  const exp = Date.now() + ttlMs
  const payload = `${TOKEN_VERSION}.${scope}.${exp}`
  const signature = await hmac(payload, getSecret())
  return `${payload}.${signature}`
}

/**
 * Valida la cookie de sesión CONTRA EL SCOPE que se está intentando abrir. Una sesión
 * de 'v2' no abre el link de 'v3' ni el general, aunque la firma sea válida.
 */
export async function verifyDriverSessionToken(
  token: string | undefined | null,
  expectedScope: string
): Promise<boolean> {
  if (!token) return false
  const secret = getSecret()
  if (!secret) return false

  const parts = token.split('.')
  if (parts.length !== 4) return false

  const [version, scope, expStr, signature] = parts
  if (version !== TOKEN_VERSION) return false
  if (!safeEqual(scope, expectedScope)) return false

  const exp = Number(expStr)
  if (!Number.isFinite(exp) || Date.now() > exp) return false

  const expected = await hmac(`${version}.${scope}.${expStr}`, secret)
  return safeEqual(signature, expected)
}
