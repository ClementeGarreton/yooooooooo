import { NextRequest, NextResponse } from 'next/server'
import { customerIdFromRequest } from '@/lib/customerSession'
import { CreditError, requestWithdrawal } from '@/lib/referralCredits'

export const dynamic = 'force-dynamic'

/** El cliente pide retirar todo su saldo de créditos. Avisa por correo a Yo me encargo. */
export async function POST(request: NextRequest) {
  const customerId = await customerIdFromRequest(request)
  if (!customerId) return NextResponse.json({ error: 'Tu sesión venció. Vuelve a entrar.' }, { status: 401 })
  try {
    const { amount } = await requestWithdrawal(customerId)
    return NextResponse.json({ ok: true, amount })
  } catch (error) {
    if (error instanceof CreditError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('[cuenta/creditos/retirar] Error:', error)
    return NextResponse.json({ error: 'No se pudo registrar el retiro.' }, { status: 500 })
  }
}
