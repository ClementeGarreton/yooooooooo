import { toHiddenFileUrl } from '@/lib/fileLinks'
import { NextRequest, NextResponse } from 'next/server'
import { customerIdFromRequest } from '@/lib/customerSession'
import { getOwnedQuote } from '@/lib/customerAccount'

export const dynamic = 'force-dynamic'

/**
 * PDF de una cotización del cliente de la sesión. Redirige al PDF que ya se generó al
 * cotizar (medido el 01-10-2026: las 87 cotizaciones vigentes lo tienen). Una cotización
 * de otra persona responde igual que una que no existe.
 */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const customerId = await customerIdFromRequest(request)
  if (!customerId) {
    return NextResponse.redirect(new URL('/mi-cuenta/ingresar', request.url))
  }

  const quote = await getOwnedQuote(customerId, params.id)
  if (!quote?.pdf_url) {
    return NextResponse.json({ error: 'Esta cotización no tiene PDF' }, { status: 404 })
  }

  // Por el dominio del sitio: la dirección del almacenamiento no llega al navegador.
  return NextResponse.redirect(new URL(toHiddenFileUrl(quote.pdf_url), request.url))
}
