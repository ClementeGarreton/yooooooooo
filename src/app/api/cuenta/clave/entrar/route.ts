import { NextRequest, NextResponse } from 'next/server'
import { loginWithPassword } from '@/lib/customerPassword'
import { setCustomerSessionCookie } from '@/lib/customerSessionCookie'

export const dynamic = 'force-dynamic'

/**
 * Entrar al Panel del Cliente con correo y clave. El error es el mismo para correo
 * inexistente, cuenta sin clave y clave equivocada. Tope de intentos por IP en el
 * middleware (RATE_LIMIT_RULES).
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  try {
    const customerId = await loginWithPassword(body?.email, body?.password)
    if (!customerId) return NextResponse.json({ error: 'Correo o clave incorrectos' }, { status: 401 })
    const response = NextResponse.json({ ok: true })
    await setCustomerSessionCookie(response, customerId, request.url.startsWith('https://'))
    return response
  } catch (error) {
    console.error('[cuenta/clave/entrar] Error:', error)
    return NextResponse.json({ error: 'No pudimos abrir tu cuenta. Intenta de nuevo.' }, { status: 500 })
  }
}
