import type { NextResponse } from 'next/server'
import { CUSTOMER_SESSION_COOKIE, CUSTOMER_SESSION_TTL_MS, createCustomerSessionToken } from '@/lib/customerSession'

/** Deja la cookie de sesión del Panel del Cliente en una respuesta. */
export async function setCustomerSessionCookie(response: NextResponse, customerId: string, secure: boolean): Promise<void> {
  response.cookies.set(CUSTOMER_SESSION_COOKIE, await createCustomerSessionToken(customerId), {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    maxAge: Math.floor(CUSTOMER_SESSION_TTL_MS / 1000),
    path: '/',
  })
}
