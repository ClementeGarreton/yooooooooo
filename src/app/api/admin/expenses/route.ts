import { NextResponse } from 'next/server'
import { ExpenseError, getWorkerExpenses } from '@/lib/workerExpenses'

export const dynamic = 'force-dynamic'

/** Gastos rendidos por los trabajadores, con cuántos esperan decisión (`pending`). */
export async function GET() {
  try {
    return NextResponse.json(await getWorkerExpenses())
  } catch (error) {
    if (!(error instanceof ExpenseError)) console.error('[admin/expenses] Error:', error)
    return NextResponse.json({ error: 'No se pudieron cargar los gastos' }, { status: 500 })
  }
}
