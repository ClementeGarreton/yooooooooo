import { NextRequest, NextResponse } from 'next/server'
import { customerIdFromRequest } from '@/lib/customerSession'
import { setCustomerPassword } from '@/lib/customerPassword'

export const dynamic = 'force-dynamic'

/**
 * Crea o cambia la clave del cliente de la sesión. Body: `{ password }`. No pide la clave
 * anterior a propósito: es también la forma de recuperarla (se entra por el link al
 * correo y se crea una nueva).
 */
export async function POST(request: NextRequest) {
  const customerId = await customerIdFromRequest(request)
  if (!customerId) return NextResponse.json({ error: 'Tu sesión venció. Vuelve a entrar.' }, { status: 401 })
  const body = await request.json().catch(() => ({}))
  const error = await setCustomerPassword(customerId, body?.password)
  if (error) return NextResponse.json({ error }, { status: 400 })
  return NextResponse.json({ ok: true })
}
