import { NextRequest, NextResponse } from 'next/server'
import { CompanyPanelError, getCompanyPanel } from '@/lib/companyPanel'

export const dynamic = 'force-dynamic'

/** Panel de la empresa: trabajos con su cuadrilla, facturas, cierres vigentes y notas. */
export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    return NextResponse.json(await getCompanyPanel(params.id))
  } catch (error) {
    if (error instanceof CompanyPanelError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('[admin/companies/panel] Error:', error)
    return NextResponse.json({ error: 'No se pudo cargar el panel de la empresa' }, { status: 500 })
  }
}
