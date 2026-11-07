import { NextRequest, NextResponse } from 'next/server'
import { resolveDriverAccess } from '@/lib/driverAccess'
import {
  createDriverSessionToken,
  driverSessionCookieName,
  isValidDriverPin,
} from '@/lib/driverSession'

export const dynamic = 'force-dynamic'

/**
 * Valida el PIN del panel de choferes y entrega una cookie de sesión firmada.
 * Exige además el token del link: sin link válido, el PIN por sí solo no sirve.
 *
 * El PIN que se compara es el DEL CAMIÓN al que pertenece el link (o el general si el
 * camión no tiene uno propio), y la sesión queda atada a ese camión: no sirve para
 * abrir el link de otro. El rate limit anti fuerza bruta está en el middleware
 * (ver RATE_LIMIT_RULES).
 */
export async function POST(request: NextRequest) {
  try {
    const { pin, token } = await request.json()

    const access = await resolveDriverAccess(String(token || ''))
    if (!access) {
      return NextResponse.json({ error: 'Enlace no válido' }, { status: 403 })
    }

    if (!isValidDriverPin(String(pin || ''), access.pin)) {
      return NextResponse.json({ error: 'PIN incorrecto' }, { status: 401 })
    }

    const sessionToken = await createDriverSessionToken(access.scope)
    const response = NextResponse.json({ success: true })

    response.cookies.set(driverSessionCookieName(access.scope), sessionToken, {
      httpOnly: true,
      secure: request.url.startsWith('https://'),
      sameSite: 'lax',
      // Igual que el TTL del token firmado (driverSession.DEFAULT_TTL_MS): 30 días.
      maxAge: 30 * 24 * 60 * 60,
      path: '/',
    })

    return response
  } catch (error) {
    console.error('Error verificando PIN de choferes:', error)
    return NextResponse.json({ error: 'Error al verificar el PIN' }, { status: 500 })
  }
}
