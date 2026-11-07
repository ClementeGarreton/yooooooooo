import { NextRequest, NextResponse } from 'next/server'
import { getIncomeStatement, getMonthlyIncomeStatement } from '@/lib/companyExpenses'

export const dynamic = 'force-dynamic'

/**
 * Estado de resultados de gestión. `?meses=N` devuelve los últimos N meses, uno por columna;
 * `?desde=&hasta=` devuelve un solo período. Por fecha del servicio. Solo lectura.
 */
export const maxDuration = 60

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams
    if (params.get('meses')) return NextResponse.json(await getMonthlyIncomeStatement(params.get('meses')))
    return NextResponse.json(await getIncomeStatement(params.get('desde'), params.get('hasta')))
  } catch (error) {
    console.error('[admin/accounting/income-statement] Error:', error)
    return NextResponse.json({ error: 'No se pudo calcular el estado de resultados' }, { status: 500 })
  }
}
