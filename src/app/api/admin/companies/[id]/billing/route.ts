import { NextRequest, NextResponse } from 'next/server'
import { getActorFromRequest, logAdminAction } from '@/lib/activityLog'
import { hasAdminAction } from '@/lib/adminPermissions'
import { InvoiceError, getCompanyBilling, previewInvoice } from '@/lib/invoicing'

export const dynamic = 'force-dynamic'

/** Lo del mes de una empresa: reservas con sus montos y las facturas del período. `?period=YYYY-MM`. */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const period = request.nextUrl.searchParams.get('period') || ''
    return NextResponse.json(await getCompanyBilling(params.id, period))
  } catch (error) {
    if (error instanceof InvoiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('[admin/companies/billing] Error:', error)
    return NextResponse.json({ error: 'No se pudo cargar la facturación' }, { status: 500 })
  }
}

/**
 * Vista previa ante el SII de la factura del mes. Body: `{ period, bookingIds }`. No emite
 * nada. Solo el perfil Administrador: es el primer paso de un documento tributario.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  if (!(await hasAdminAction(request, 'invoices.emit'))) {
    return NextResponse.json({ error: 'Tu perfil no tiene permiso para facturar.' }, { status: 403 })
  }
  try {
    const body = await request.json().catch(() => ({}))
    const actor = getActorFromRequest(request)
    const invoice = await previewInvoice(params.id, String(body?.period || ''), body?.bookingIds, actor?.username || 'administrador')
    await logAdminAction({
      actor,
      action: 'invoice.previewed',
      entityType: 'company',
      entityId: params.id,
      entityLabel: `Factura ${invoice.period}`,
      summary: `Previsualizó la factura de ${invoice.period}: ${invoice.bookingCount} reserva(s), total $${(invoice.total || 0).toLocaleString('es-CL')}`,
      request,
    })
    return NextResponse.json({ invoice })
  } catch (error) {
    if (error instanceof InvoiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('[admin/companies/billing] Error previsualizando:', error)
    return NextResponse.json({ error: 'No se pudo previsualizar la factura' }, { status: 500 })
  }
}
