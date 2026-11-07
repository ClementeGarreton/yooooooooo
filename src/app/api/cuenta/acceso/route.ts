import { NextRequest, NextResponse } from 'next/server'
import { requestLoginLink } from '@/lib/customerLogin'
import { getClientIp } from '@/lib/rateLimit'

export const dynamic = 'force-dynamic'

/**
 * Pide un link de acceso al Panel del Cliente.
 *
 * Responde lo mismo exista o no el correo (ver customerLogin.ts): el único error que se
 * devuelve es un formato de correo inválido. El rate limit por IP está en el middleware
 * (RATE_LIMIT_RULES) y el tope por cliente, en requestLoginLink.
 */
export async function POST(request: NextRequest) {
  let email = ''
  try {
    const body = await request.json()
    email = String(body?.email || '')
  } catch {
    return NextResponse.json({ error: 'Solicitud inválida' }, { status: 400 })
  }

  const result = await requestLoginLink(email, getClientIp(request.headers, request.ip))

  if (result.kind === 'invalid_email') {
    return NextResponse.json({ error: 'Revisa el formato del correo' }, { status: 400 })
  }

  console.info(`[cuenta/acceso] Pedido de link: ${result.detail}`)
  return NextResponse.json(
    { ok: true },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
