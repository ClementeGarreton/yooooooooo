import { NextRequest, NextResponse } from 'next/server'
import { getActorFromRequest, logAdminAction } from '@/lib/activityLog'
import { hasAdminAction } from '@/lib/adminPermissions'
import { InvoiceError, emitInvoice } from '@/lib/invoicing'

export const dynamic = 'force-dynamic'
// Emitir espera al SII: se le da más aire que a una ruta común.
export const maxDuration = 180

/**
 * Emite ante el SII una factura ya previsualizada, o consulta un intento que quedó a
 * medias (misma clave de idempotencia, no reenvía nada). Solo el perfil Administrador.
 * No hay ambiente de prueba: lo que sale de acá es un documento tributario real.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  if (!(await hasAdminAction(request, 'invoices.emit'))) {
    return NextResponse.json({ error: 'Tu perfil no tiene permiso para emitir facturas.' }, { status: 403 })
  }
  try {
    const actor = getActorFromRequest(request)
    const invoice = await emitInvoice(params.id, actor?.username || 'administrador')
    await logAdminAction({
      actor,
      action: invoice.status === 'emitida' ? 'invoice.emitted' : 'invoice.emit_attempted',
      entityType: 'invoice',
      entityId: invoice.id,
      entityLabel: invoice.folio ? `Factura ${invoice.folio}` : `Factura ${invoice.period}`,
      summary:
        invoice.status === 'emitida'
          ? `Emitió la factura folio ${invoice.folio} (${invoice.period}) por $${(invoice.total || 0).toLocaleString('es-CL')}`
          : `Intentó emitir la factura de ${invoice.period}: ${invoice.status}${invoice.errorCode ? ` (${invoice.errorCode})` : ''}`,
      result: invoice.status === 'emitida' ? 'success' : 'error',
      request,
    })
    return NextResponse.json({ invoice })
  } catch (error) {
    if (error instanceof InvoiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('[admin/invoices/emit] Error:', error)
    return NextResponse.json({ error: 'No se pudo emitir la factura' }, { status: 500 })
  }
}
