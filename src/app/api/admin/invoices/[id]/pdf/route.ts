import { NextResponse } from 'next/server'
import { getInvoicePdf } from '@/lib/invoicing'

export const dynamic = 'force-dynamic'
// El SII puede tardar en devolver el documento.
export const maxDuration = 120

/** El PDF oficial de una factura emitida, para verlo en el navegador o descargarlo (`?descargar=1`). */
export async function GET(request: Request, { params }: { params: { id: string } }) {
  const pdf = await getInvoicePdf(params.id)
  if (!pdf.ok) return NextResponse.json({ error: pdf.error }, { status: pdf.status })
  const download = new URL(request.url).searchParams.get('descargar') === '1'
  return new NextResponse(new Uint8Array(pdf.bytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${pdf.fileName}"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
