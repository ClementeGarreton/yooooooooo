import { NextResponse } from 'next/server'
import { getInvoiceXml } from '@/lib/invoicing'

export const dynamic = 'force-dynamic'

/** Descarga el XML firmado de una factura emitida: es el documento tributario. */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const doc = await getInvoiceXml(params.id)
  if (!doc) return NextResponse.json({ error: 'Factura no encontrada o sin XML guardado' }, { status: 404 })
  return new NextResponse(doc.xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Content-Disposition': `attachment; filename="factura-${doc.folio.replace(/[^0-9A-Za-z-]/g, '')}.xml"`,
    },
  })
}
