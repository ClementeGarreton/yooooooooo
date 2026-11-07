import { NextRequest, NextResponse } from 'next/server'
import { getActorFromRequest, logAdminAction } from '@/lib/activityLog'
import { ExpenseError, convertUploadToExpense, reviewWorkerExpense, updateWorkerExpense } from '@/lib/workerExpenses'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Aprueba o rechaza un gasto. Body: `{ decision: 'aprobado' | 'rechazado', reason? }`. */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  if (!UUID_RE.test(params.id)) return NextResponse.json({ error: 'Gasto no encontrado' }, { status: 404 })
  const body = await request.json().catch(() => ({}))
  if (body?.decision !== 'aprobado' && body?.decision !== 'rechazado') {
    return NextResponse.json({ error: 'Decisión inválida' }, { status: 400 })
  }
  const actor = getActorFromRequest(request)
  try {
    const expense = await reviewWorkerExpense({
      id: params.id,
      decision: body.decision,
      reason: body.reason,
      reviewedBy: actor?.username || 'administrador',
    })
    const monto = `$${Math.round(expense.amount).toLocaleString('es-CL')}`
    await logAdminAction({
      actor,
      action: body.decision === 'aprobado' ? 'expense.approved' : 'expense.rejected',
      entityType: 'document',
      entityId: params.id,
      entityLabel: `${expense.name} · ${monto}`,
      summary: `${body.decision === 'aprobado' ? 'Aprobó' : 'Rechazó'} el gasto «${expense.name}» (${monto}) de ${expense.workerLabel}`,
      request,
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof ExpenseError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('[admin/expenses] Error:', error)
    return NextResponse.json({ error: 'No se pudo guardar la decisión' }, { status: 500 })
  }
}

/** Forma de pago y reembolso de un gasto. Body: `{ payment?: 'contado' | 'credito', reimbursed?: boolean }`. */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  if (!UUID_RE.test(params.id)) return NextResponse.json({ error: 'Gasto no encontrado' }, { status: 404 })
  const actor = getActorFromRequest(request)
  try {
    const expense = await updateWorkerExpense(params.id, await request.json().catch(() => ({})), actor?.username || 'administrador')
    const monto = `$${Math.round(expense.amount).toLocaleString('es-CL')}`
    await logAdminAction({
      actor,
      action: 'expense.updated',
      entityType: 'document',
      entityId: params.id,
      entityLabel: `${expense.name} · ${monto}`,
      summary: `Cambió el gasto «${expense.name}» (${monto}) de ${expense.workerLabel}: ${expense.change}`,
      request,
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof ExpenseError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('[admin/expenses] Error:', error)
    return NextResponse.json({ error: 'No se pudo guardar el cambio' }, { status: 500 })
  }
}

/**
 * Pasa a gasto una foto o documento que un trabajador subió sin monto.
 * Body: `{ name, amount, payment: 'contado' | 'credito', docNumber? }`.
 */
export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  if (!UUID_RE.test(params.id)) return NextResponse.json({ error: 'Archivo no encontrado' }, { status: 404 })
  const actor = getActorFromRequest(request)
  try {
    const expense = await convertUploadToExpense(params.id, await request.json().catch(() => ({})), actor?.username || 'administrador')
    const monto = `$${Math.round(expense.amount).toLocaleString('es-CL')}`
    await logAdminAction({
      actor,
      action: 'expense.created_from_upload',
      entityType: 'document',
      entityId: params.id,
      entityLabel: `${expense.name} · ${monto}`,
      summary: `Registró como gasto «${expense.name}» (${monto}) un archivo que subió ${expense.workerLabel}`,
      request,
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof ExpenseError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('[admin/expenses] Error:', error)
    return NextResponse.json({ error: 'No se pudo registrar el gasto' }, { status: 500 })
  }
}
