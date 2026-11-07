import { NextRequest, NextResponse } from 'next/server'
import { firstTimeWithRut } from '@/lib/customerPassword'
import { setCustomerSessionCookie } from '@/lib/customerSessionCookie'

export const dynamic = 'force-dynamic'

/**
 * Primera vez en el Panel del Cliente: correo + RUT + la clave que quiere usar. Solo
 * funciona si la cuenta todavía no tiene clave y el RUT es el que confirmó el equipo.
 * Body: `{ email, rut, password }`. Tope de intentos por IP en el middleware, más
 * estricto que el de entrar con clave: acá lo que se prueba es un RUT.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  try {
    const result = await firstTimeWithRut(body?.email, body?.rut, body?.password)
    if (!result.ok) return NextResponse.json({ error: result.message }, { status: result.reason === 'weak' ? 400 : 401 })
    const response = NextResponse.json({ ok: true })
    await setCustomerSessionCookie(response, result.customerId, request.url.startsWith('https://'))
    return response
  } catch (error) {
    console.error('[cuenta/clave/primera-vez] Error:', error)
    return NextResponse.json({ error: 'No pudimos crear tu clave. Intenta de nuevo.' }, { status: 500 })
  }
}
