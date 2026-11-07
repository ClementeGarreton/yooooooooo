import { NextRequest, NextResponse } from 'next/server'
import { getActorFromRequest, logAdminAction } from '@/lib/activityLog'
import { ExpenseInputError, addExpense, getExpenses, removeExpense, setWorkerExpenseCategory } from '@/lib/companyExpenses'

export const dynamic = 'force-dynamic'

function fail(error: unknown, fallback: string) {
  if (error instanceof ExpenseInputError) return NextResponse.json({ error: error.message }, { status: error.status })
  console.error('[admin/accounting/expenses] Error:', error)
  return NextResponse.json({ error: fallback }, { status: 500 })
}

/** Gastos de la empresa de `?desde=&hasta=`, y los rendidos por trabajadores ya aprobados. */
export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams
    return NextResponse.json(await getExpenses(params.get('desde'), params.get('hasta')))
  } catch (error) {
    return fail(error, 'No se pudieron cargar los gastos')
  }
}

/** Carga un gasto. Body: `{ date, category, description, amount, iva?, provider?, docNumber? }`. */
export async function POST(request: NextRequest) {
  const actor = getActorFromRequest(request)
  try {
    const expense = await addExpense(await request.json().catch(() => ({})), actor?.username || 'administrador')
    await logAdminAction({
      actor,
      action: 'company_expense.added',
      entityType: 'expense',
      entityId: expense.id,
      entityLabel: expense.description,
      summary: `Cargó un gasto de $${expense.amount.toLocaleString('es-CL')}: ${expense.description}`,
      request,
    })
    return NextResponse.json({ ok: true, expense }, { status: 201 })
  } catch (error) {
    return fail(error, 'No se pudo guardar el gasto')
  }
}

/** Quita un gasto cargado por error. `?id=`. */
export async function DELETE(request: NextRequest) {
  const actor = getActorFromRequest(request)
  try {
    const removed = await removeExpense(request.nextUrl.searchParams.get('id'))
    await logAdminAction({
      actor,
      action: 'company_expense.removed',
      entityType: 'expense',
      entityLabel: removed.description,
      summary: `Quitó un gasto de $${removed.amount.toLocaleString('es-CL')}: ${removed.description}`,
      request,
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return fail(error, 'No se pudo quitar el gasto')
  }
}

/** Categoría de un gasto rendido por un trabajador. Body: `{ workerExpenseId, category }` (`null` la quita). */
export async function PATCH(request: NextRequest) {
  const actor = getActorFromRequest(request)
  try {
    const body = await request.json().catch(() => ({}))
    const result = await setWorkerExpenseCategory(body?.workerExpenseId, body?.category ?? null)
    await logAdminAction({
      actor,
      action: 'expense.categorized',
      entityType: 'document',
      entityId: String(body?.workerExpenseId),
      entityLabel: result.name,
      summary: `Categorizó el gasto «${result.name}» como ${result.label}`,
      request,
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return fail(error, 'No se pudo guardar la categoría')
  }
}
