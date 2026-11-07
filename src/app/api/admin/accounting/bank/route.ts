import { NextRequest, NextResponse } from 'next/server'
import { getBankMonth } from '@/lib/accounting'

export const dynamic = 'force-dynamic'

/** Movimientos y saldos del banco ya sincronizados. `?mes=YYYY-MM`. Solo lectura: no contacta al banco. */
export async function GET(request: NextRequest) {
  try {
    return NextResponse.json(await getBankMonth(request.nextUrl.searchParams.get('mes')))
  } catch (error) {
    console.error('[admin/accounting/bank] Error:', error)
    return NextResponse.json({ error: 'No se pudieron leer los movimientos del banco' }, { status: 500 })
  }
}
