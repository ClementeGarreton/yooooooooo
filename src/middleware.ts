import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { verifySessionToken } from '@/lib/adminSession'
import { ADMIN_PREVIEW_COOKIE } from '@/lib/adminPreview'
import { canCallRoute, modulesForRoute } from '@/lib/adminAccess'
import { getAccessForMiddleware } from '@/lib/adminAccessEdge'
import {
  checkRateLimit,
  findRateLimitRule,
  getClientIp,
  isRateLimitExempt,
} from '@/lib/rateLimit'

// Rutas de admin que NO requieren sesión válida.
const PUBLIC_ADMIN_PATHS = new Set<string>(['/admin/login'])

// Endpoints /api/admin/* de SOLO LECTURA (GET) que el cotizador público necesita para
// funcionar sin sesión: catálogo de items, configuración de precios y de agenda. Son
// datos que el cotizador ya muestra a cualquier visitante. Las MUTACIONES (POST/PUT/
// PATCH/DELETE) sobre estos mismos paths siguen exigiendo sesión de admin.
const PUBLIC_ADMIN_READ_APIS = new Set<string>([
  '/api/admin/catalog-items',
  '/api/admin/pricing-config',
  '/api/admin/schedule-config',
])

/**
 * Rate limit por IP sobre /api/*. Devuelve una respuesta 429 si hay que cortar, o null
 * para seguir. Se aplica ANTES de la comprobación de sesión para que también proteja el
 * login de admin contra fuerza bruta.
 */
function enforceRateLimit(request: NextRequest, pathname: string): NextResponse | null {
  if (!pathname.startsWith('/api/')) return null
  if (isRateLimitExempt(pathname)) return null

  const rule = findRateLimitRule(pathname)
  if (!rule) return null

  const ip = getClientIp(request.headers, request.ip)
  const result = checkRateLimit(ip, rule)

  if (result.ok) return null

  console.warn(
    `[rate-limit] 429 ${pathname} ip=${ip} bucket=${rule.bucket} limit=${rule.limit}`
  )

  return NextResponse.json(
    { error: 'Demasiadas peticiones. Intenta de nuevo en unos minutos.' },
    {
      status: 429,
      headers: {
        'Retry-After': String(result.retryAfterSec),
        'X-RateLimit-Limit': String(result.limit),
        'X-RateLimit-Remaining': '0',
        'Cache-Control': 'no-store',
      },
    }
  )
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // 1) Rate limit: primero, y para toda /api/* (pública y de admin).
  const limited = enforceRateLimit(request, pathname)
  if (limited) return limited

  // 1b) Vista de administrador («Ver como», adminPreview.ts): es SOLO LECTURA. Mientras el
  // navegador tenga esa cookie, ninguna ruta del panel del cliente ni del trabajador
  // responde: no se paga, no se reprograma, no se sube ni se registra nada, ni a nombre de
  // la persona que se está mirando ni con la sesión propia que el admin pueda tener abierta.
  // Basta la presencia de la cookie (no se valida la firma): ante la duda, se bloquea.
  // Única excepción: ABRIR un archivo del trabajador que se está mirando (GET, no cambia
  // nada). Sin ella el administrador bajaba un JSON de error con nombre de foto y lo veía
  // como «archivo dañado». La ruta comprueba la vista y a quién pertenece el archivo.
  const previewFileRead =
    (request.method === 'GET' || request.method === 'HEAD') && /^\/api\/trabajos\/documentos\/[0-9a-f-]{36}$/i.test(pathname)
  if (
    request.cookies.get(ADMIN_PREVIEW_COOKIE)?.value &&
    !previewFileRead &&
    (pathname.startsWith('/api/cuenta/') || pathname.startsWith('/api/trabajos/'))
  ) {
    return NextResponse.json(
      { error: 'Estás en la vista de administrador, que es solo lectura. Sal de la vista para hacer cambios.' },
      { status: 403 }
    )
  }

  // 2) Autenticación de admin.
  const isAdminPage = pathname.startsWith('/admin')
  const isAdminApi = pathname.startsWith('/api/admin')

  // Solo custodiamos páginas de admin y APIs de admin.
  if (!isAdminPage && !isAdminApi) {
    return NextResponse.next()
  }

  // Excepciones públicas / de sistema.
  if (PUBLIC_ADMIN_PATHS.has(pathname)) return NextResponse.next()
  // Solo login y logout son públicos. OJO: `change-password` NO va acá — necesita sesión
  // válida, porque la identidad de quien cambia la clave sale de la cookie firmada.
  if (pathname === '/api/admin/auth/login' || pathname === '/api/admin/auth/logout') {
    return NextResponse.next()
  }
  // Cron de Vercel (vercel.json): el GET se protege solo con CRON_SECRET. El POST es el disparo
  // manual y exige sesión de admin; antes cualquiera podía lanzar la limpieza.
  if (pathname === '/api/admin/cleanup-bookings' && request.method === 'GET') return NextResponse.next()
  // Lectura pública del catálogo/precios/agenda que consume el cotizador (solo GET).
  if (request.method === 'GET' && PUBLIC_ADMIN_READ_APIS.has(pathname)) {
    return NextResponse.next()
  }

  const token = request.cookies.get('admin_authenticated')?.value
  const actor = await verifySessionToken(token)

  if (!actor) {
    if (isAdminApi) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }
    const loginUrl = new URL('/admin/login', request.url)
    return NextResponse.redirect(loginUrl)
  }

  // 3) Candado por módulo: una ruta de un módulo que el perfil del usuario tiene apagado
  // responde 403 aunque se llame a mano (ver adminAccess.ts). Solo se consulta el perfil
  // cuando la ruta tiene candado. Si el perfil no se puede resolver, se deja pasar.
  if (isAdminApi && modulesForRoute(pathname, request.method)) {
    const access = await getAccessForMiddleware(actor.id)
    if (access && !canCallRoute(access, pathname, request.method)) {
      return NextResponse.json(
        { error: 'Tu perfil no tiene acceso a este módulo. Pídele a un administrador que lo active.' },
        { status: 403 }
      )
    }
  }

  // Propagamos la identidad a los route handlers para el log de auditoría.
  // Se ESCRIBEN siempre (no se leen del request entrante), así un cliente no puede
  // suplantar a otro usuario mandando estos headers por su cuenta.
  const headers = new Headers(request.headers)
  headers.set('x-admin-user', actor.username)
  headers.set('x-admin-user-id', actor.id)

  return NextResponse.next({ request: { headers } })
}

export const config = {
  // `/api/:path*` cubre también `/api/admin/:path*`.
  matcher: ['/admin/:path*', '/api/:path*'],
}
