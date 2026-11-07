import { NextRequest, NextResponse } from 'next/server'
import { getFinanceData } from '@/lib/finance'

export const dynamic = 'force-dynamic'

/** Panel de Finanzas: la plata de un mes. `?mes=YYYY-MM` (por defecto, el mes en curso) o un rango `?desde=&hasta=`. Solo lectura. */
export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams
    return NextResponse.json(
      await getFinanceData(params.get('mes'), { desde: params.get('desde'), hasta: params.get('hasta') })
    )
  } catch (error) {
    console.error('[admin/finance] Error:', error)
    return NextResponse.json({ error: 'No se pudo cargar Finanzas' }, { status: 500 })
  }
}
