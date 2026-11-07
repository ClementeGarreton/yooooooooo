import { NextResponse } from 'next/server'
import { CUSTOMER_SESSION_COOKIE } from '@/lib/customerSession'

export const dynamic = 'force-dynamic'

/** Cierra la sesión del Panel del Cliente en este navegador. */
export async function POST() {
  const response = NextResponse.json({ ok: true })
  response.cookies.set(CUSTOMER_SESSION_COOKIE, '', { httpOnly: true, maxAge: 0, path: '/' })
  return response
}
