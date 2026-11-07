import { NextRequest, NextResponse } from 'next/server'
import { customerIdFromRequest } from '@/lib/customerSession'
import { getQuoteResume } from '@/lib/customerAccount'

export const dynamic = 'force-dynamic'

/**
 * Lo que el cliente cargó en una cotización suya, para reabrir el cotizador con todo puesto.
 * Una cotización de otra persona responde igual que una que no existe.
 */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const customerId = await customerIdFromRequest(request)
  if (!customerId) return NextResponse.json({ error: 'Sesión vencida' }, { status: 401 })

  const resume = await getQuoteResume(customerId, params.id)
  if (!resume) return NextResponse.json({ error: 'Esta cotización no se puede retomar' }, { status: 404 })
  return NextResponse.json(resume, { headers: { 'Cache-Control': 'no-store' } })
}
