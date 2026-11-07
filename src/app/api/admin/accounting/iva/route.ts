import { NextRequest, NextResponse } from 'next/server'
import { getIvaMonth } from '@/lib/accounting'

export const dynamic = 'force-dynamic'

/** IVA de un mes según el Registro de Compras y Ventas del SII. `?mes=YYYY-MM`. Solo lectura. */
export async function GET(request: NextRequest) {
  try {
    return NextResponse.json(await getIvaMonth(request.nextUrl.searchParams.get('mes')))
  } catch (error) {
    console.error('[admin/accounting/iva] Error:', error)
    return NextResponse.json({ error: 'No se pudo leer el IVA del mes' }, { status: 500 })
  }
}
