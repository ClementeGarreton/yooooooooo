import { NextRequest, NextResponse } from 'next/server'
import { consumeLoginToken } from '@/lib/customerLogin'
import {
  CUSTOMER_SESSION_COOKIE,
  CUSTOMER_SESSION_TTL_MS,
  createCustomerSessionToken,
} from '@/lib/customerSession'

export const dynamic = 'force-dynamic'

/**
 * Canjea el link del correo por una sesión. Es POST a propósito: abrir el link (GET) no
 * lo gasta, así los antivirus de correo que lo revisan no lo dejan usado (ver
 * customerLogin.ts, punto 3).
 */
export async function POST(request: NextRequest) {
  let token = ''
  try {
    const body = await request.json()
    token = String(body?.token || '')
  } catch {
    return NextResponse.json({ error: 'Solicitud inválida' }, { status: 400 })
  }

  try {
    const customerId = await consumeLoginToken(token)
    if (!customerId) {
      return NextResponse.json(
        { error: 'El link venció o ya se usó. Pide uno nuevo.' },
        { status: 401 }
      )
    }

    const sessionToken = await createCustomerSessionToken(customerId)
    const response = NextResponse.json({ ok: true })
    response.cookies.set(CUSTOMER_SESSION_COOKIE, sessionToken, {
      httpOnly: true,
      secure: request.url.startsWith('https://'),
      sameSite: 'lax',
      maxAge: Math.floor(CUSTOMER_SESSION_TTL_MS / 1000),
      path: '/',
    })
    return response
  } catch (error) {
    console.error('[cuenta/entrar] Error abriendo la sesión:', error)
    return NextResponse.json({ error: 'No pudimos abrir tu cuenta' }, { status: 500 })
  }
}
