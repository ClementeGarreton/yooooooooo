import { NextRequest, NextResponse } from 'next/server'
import { customerIdFromRequest } from '@/lib/customerSession'
import { CreditError, saveBankData } from '@/lib/referralCredits'

export const dynamic = 'force-dynamic'

/** Guarda los datos de transferencia del cliente (para retirar sus créditos). */
export async function POST(request: NextRequest) {
  const customerId = await customerIdFromRequest(request)
  if (!customerId) return NextResponse.json({ error: 'Tu sesión venció. Vuelve a entrar.' }, { status: 401 })
  try {
    return NextResponse.json({ ok: true, bank: await saveBankData(customerId, await request.json().catch(() => ({}))) })
  } catch (error) {
    if (error instanceof CreditError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('[cuenta/creditos/datos] Error:', error)
    return NextResponse.json({ error: 'No se pudieron guardar tus datos.' }, { status: 500 })
  }
}
