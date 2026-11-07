import { NextRequest, NextResponse } from 'next/server'
import { getActorFromRequest, logAdminAction } from '@/lib/activityLog'
import { ExpenseInputError, addExpenseCategory, getExpenseCategories, removeExpenseCategory } from '@/lib/companyExpenses'

export const dynamic = 'force-dynamic'

function fail(error: unknown, fallback: string) {
  if (error instanceof ExpenseInputError) return NextResponse.json({ error: error.message }, { status: error.status })
  console.error('[admin/accounting/expense-categories] Error:', error)
  return NextResponse.json({ error: fallback }, { status: 500 })
}

export async function GET() {
  return NextResponse.json(await getExpenseCategories())
}

/** Crea una categoría de gasto. Body: `{ label }`. */
export async function POST(request: NextRequest) {
  const actor = getActorFromRequest(request)
  try {
    const body = await request.json().catch(() => ({}))
    const category = await addExpenseCategory(body?.label, actor?.username || 'administrador')
    await logAdminAction({
      actor,
      action: 'expense_category.added',
      entityType: 'settings',
      entityLabel: category.label,
      summary: `Creó la categoría de gasto «${category.label}»`,
      request,
    })
    return NextResponse.json({ ok: true, category }, { status: 201 })
  } catch (error) {
    return fail(error, 'No se pudo crear la categoría')
  }
}

/** Saca de la lista una categoría creada. `?slug=`. Los gastos que la usan la conservan. */
export async function DELETE(request: NextRequest) {
  const actor = getActorFromRequest(request)
  try {
    const label = await removeExpenseCategory(request.nextUrl.searchParams.get('slug'))
    await logAdminAction({
      actor,
      action: 'expense_category.removed',
      entityType: 'settings',
      entityLabel: label,
      summary: `Quitó de la lista la categoría de gasto «${label}»`,
      request,
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return fail(error, 'No se pudo quitar la categoría')
  }
}
