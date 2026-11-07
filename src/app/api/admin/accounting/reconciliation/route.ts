import { NextRequest, NextResponse } from 'next/server'
import { getBankReconciliation } from '@/lib/bankReconciliation'

export const dynamic = 'force-dynamic'

/** Cruce de un mes entre el banco y el panel (ingresos y gastos). `?mes=YYYY-MM`. Solo lectura. */
export async function GET(request: NextRequest) {
  try {
    return NextResponse.json(await getBankReconciliation(request.nextUrl.searchParams.get('mes')))
  } catch (error) {
    console.error('[admin/accounting/reconciliation] Error:', error)
    return NextResponse.json({ error: 'No se pudo hacer el cruce con el banco' }, { status: 500 })
  }
}
