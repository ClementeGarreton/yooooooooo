import { NextRequest, NextResponse } from 'next/server'
import { getFlowMonth } from '@/lib/accounting'

export const dynamic = 'force-dynamic'
// Recorre Flow día por día: necesita más que el tiempo por defecto.
export const maxDuration = 60

/** Cobros de Flow del mes contra el libro de cobros del panel. `?mes=YYYY-MM`. Solo lectura. */
export async function GET(request: NextRequest) {
  try {
    return NextResponse.json(await getFlowMonth(request.nextUrl.searchParams.get('mes')))
  } catch (error) {
    console.error('[admin/accounting/flow] Error:', error)
    return NextResponse.json({ error: 'No se pudieron leer los cobros de Flow' }, { status: 500 })
  }
}
