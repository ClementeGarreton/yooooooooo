/**
 * Gastos que rinden los trabajadores desde su panel: un comprobante con nombre y monto
 * (`documents` con kind = 'gasto'). Acá se listan para el panel y se aprueban o rechazan.
 * Las columnas de revisión son de add_expense_review.sql; sin ellas, todo gasto figura
 * como «por aprobar» y decidir devuelve un aviso claro.
 */

import { supabaseAdmin } from '@/lib/supabase'
import { findExpensesByDocNumber, normalizeDocNumber } from '@/lib/documents'
import type { ExpenseStatus, LooseUpload, WorkerExpense, WorkerExpensesData } from '@/lib/workerExpenseTypes'

export class ExpenseError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message)
    this.name = 'ExpenseError'
  }
}

const statusOf = (row: Record<string, any>): ExpenseStatus =>
  row.expense_status === 'aprobado' || row.expense_status === 'rechazado' ? row.expense_status : 'pendiente'

export async function getWorkerExpenses(): Promise<WorkerExpensesData> {
  const { data, error } = await supabaseAdmin
    .from('documents')
    .select('*')
    .eq('kind', 'gasto')
    .eq('uploaded_by_type', 'trabajador')
    .order('created_at', { ascending: false })
    .limit(300)
  if (error) throw new ExpenseError('No se pudieron cargar los gastos', 500)
  const rows = (data || []) as Record<string, any>[]

  // Lo que subieron como foto o documento en vez de gasto: no tiene monto ni entra a esta
  // bandeja. Se trae aparte para poder pasarlo a gasto (los últimos 120 días).
  const since = new Date(Date.now() - 120 * 86_400_000).toISOString()
  const { data: looseData } = await supabaseAdmin
    .from('documents')
    .select('*')
    .in('kind', ['foto', 'documento'])
    .eq('uploaded_by_type', 'trabajador')
    .not('booking_id', 'is', null)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(200)
  const looseRows = (looseData || []) as Record<string, any>[]

  const bookingIds = Array.from(new Set([...rows, ...looseRows].map((r) => r.booking_id).filter(Boolean)))
  const { data: bookings } = bookingIds.length
    ? await supabaseAdmin.from('bookings').select('*').in('id', bookingIds)
    : { data: [] as Record<string, any>[] }
  const byId = new Map(((bookings || []) as Record<string, any>[]).map((b) => [b.id, b]))

  // N° de comprobante que aparece en más de un gasto vigente (los rechazados no cuentan).
  const numberCount = new Map<string, number>()
  for (const r of rows) {
    if (r.doc_number && r.expense_status !== 'rechazado') numberCount.set(r.doc_number, (numberCount.get(r.doc_number) || 0) + 1)
  }

  const expenses: WorkerExpense[] = rows.map((r) => {
    const b = r.booking_id ? byId.get(r.booking_id) : null
    return {
      id: r.id,
      name: r.note || r.file_name || 'Gasto',
      amount: Number(r.amount) || 0,
      docNumber: r.doc_number ?? null,
      duplicateNumber: Boolean(r.doc_number) && r.expense_status !== 'rechazado' && (numberCount.get(r.doc_number) || 0) > 1,
      payment: r.expense_payment === 'credito' ? 'credito' : 'contado',
      reimbursed: Boolean(r.expense_reimbursed_at),
      reimbursedByClosing: Boolean(r.expense_closing_id) || Boolean(r.expense_payment_id),
      status: statusOf(r),
      workerLabel: r.uploaded_by_label || 'Trabajador',
      createdAt: r.created_at,
      reviewedBy: r.expense_reviewed_by ?? null,
      reviewedAt: r.expense_reviewed_at ?? null,
      rejectReason: r.expense_reject_reason ?? null,
      booking: b
        ? { id: b.id, code: b.code ?? null, quoteId: b.quote_id ?? null, clientName: b.client_name || '', date: b.scheduled_date ?? null }
        : null,
    }
  })
  const loose: LooseUpload[] = looseRows.map((r) => {
    const b = byId.get(r.booking_id)
    return {
      id: r.id,
      kind: r.kind,
      note: r.note ?? null,
      fileName: r.file_name ?? null,
      workerLabel: r.uploaded_by_label || 'Trabajador',
      createdAt: r.created_at,
      booking: b ? { code: b.code ?? null, quoteId: b.quote_id ?? null, clientName: b.client_name || '', date: b.scheduled_date ?? null } : null,
    }
  })
  const pendingList = expenses.filter((e) => e.status === 'pendiente')
  return { loose, expenses, pending: pendingList.length, pendingTotal: pendingList.reduce((sum, e) => sum + e.amount, 0) }
}

/** Aprueba o rechaza un gasto. Rechazar exige motivo. Devuelve la fila para el registro de actividad. */
export async function reviewWorkerExpense(input: {
  id: string
  decision: 'aprobado' | 'rechazado'
  reason?: string | null
  reviewedBy: string
}): Promise<{ name: string; amount: number; workerLabel: string }> {
  const reason = String(input.reason || '').trim().slice(0, 500)
  if (input.decision === 'rechazado' && !reason) throw new ExpenseError('Escribe el motivo del rechazo.')

  const { data: doc } = await supabaseAdmin
    .from('documents')
    .select('*')
    .eq('id', input.id)
    .maybeSingle()
  if (!doc || doc.kind !== 'gasto' || doc.uploaded_by_type !== 'trabajador') throw new ExpenseError('Gasto no encontrado', 404)
  // Ya reembolsado en un pago o un cierre: cambiar la decisión dejaría ese pago cubriendo un
  // gasto que ya no existe.
  if (doc.expense_payment_id || doc.expense_closing_id) {
    throw new ExpenseError('Este gasto ya se reembolsó en un pago o un cierre: no se puede cambiar la decisión.', 409)
  }

  const { error } = await supabaseAdmin
    .from('documents')
    .update({
      expense_status: input.decision,
      expense_reviewed_by: input.reviewedBy,
      expense_reviewed_at: new Date().toISOString(),
      expense_reject_reason: input.decision === 'rechazado' ? reason : null,
    })
    .eq('id', input.id)
  if (error) {
    console.error('[workerExpenses] Error guardando la decisión:', error.message)
    throw new ExpenseError('No se pudo guardar: falta correr la migración add_expense_review.sql.', 409)
  }
  return { name: doc.note || 'Gasto', amount: Number(doc.amount) || 0, workerLabel: doc.uploaded_by_label || 'Trabajador' }
}

/**
 * Corrige la forma de pago de un gasto o marca si ya se le devolvió la plata al trabajador.
 * Body: `{ payment?: 'contado' | 'credito', reimbursed?: boolean }`. Un gasto que quedó
 * reembolsado por un cierre de pagos no se cambia acá: hay que reabrir el cierre.
 */
export async function updateWorkerExpense(
  id: string,
  body: any,
  actor: string
): Promise<{ name: string; amount: number; workerLabel: string; change: string }> {
  const { data: doc } = await supabaseAdmin.from('documents').select('*').eq('id', id).maybeSingle()
  if (!doc || doc.kind !== 'gasto' || doc.uploaded_by_type !== 'trabajador') throw new ExpenseError('Gasto no encontrado', 404)
  if (doc.expense_payment_id) {
    throw new ExpenseError('Este gasto se reembolsó dentro de un pago registrado: ya no se cambia desde acá.', 409)
  }
  if (doc.expense_closing_id) {
    throw new ExpenseError('Este gasto quedó pagado en un cierre. Para cambiarlo, un Administrador tiene que reabrir ese cierre.', 409)
  }
  const update: Record<string, unknown> = {}
  const changes: string[] = []
  if (body?.payment === 'contado' || body?.payment === 'credito') {
    update.expense_payment = body.payment
    changes.push(`forma de pago: ${body.payment === 'credito' ? 'crédito' : 'contado'}`)
    // Un gasto a crédito lo pagó la empresa: no hay nada que reembolsar.
    if (body.payment === 'credito') {
      update.expense_reimbursed_at = null
      update.expense_reimbursed_by = null
    }
  }
  if (typeof body?.reimbursed === 'boolean') {
    const payment = update.expense_payment ?? (doc.expense_payment === 'credito' ? 'credito' : 'contado')
    if (payment === 'credito') throw new ExpenseError('Un gasto a crédito lo pagó la empresa: no se reembolsa.')
    update.expense_reimbursed_at = body.reimbursed ? new Date().toISOString() : null
    update.expense_reimbursed_by = body.reimbursed ? actor : null
    changes.push(body.reimbursed ? 'reembolsado' : 'pendiente de reembolso')
  }
  if (changes.length === 0) throw new ExpenseError('Nada que cambiar')
  const { error } = await supabaseAdmin.from('documents').update(update).eq('id', id)
  if (error) throw new ExpenseError('No se pudo guardar: falta correr la migración add_pay_closings.sql.', 409)
  return { name: doc.note || 'Gasto', amount: Number(doc.amount) || 0, workerLabel: doc.uploaded_by_label || 'Trabajador', change: changes.join(', ') }
}

/**
 * Pasa a gasto una foto o documento que el trabajador subió sin marcarlo como tal: le pone
 * nombre, monto y forma de pago, y lo deja «por aprobar» como cualquier otro gasto. El
 * archivo es el mismo; solo cambia cómo está clasificado. Body:
 * `{ name, amount, payment: 'contado' | 'credito', docNumber? }`.
 */
export async function convertUploadToExpense(
  id: string,
  body: any,
  actor: string
): Promise<{ name: string; amount: number; workerLabel: string }> {
  const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 120) : ''
  if (name.length < 2) throw new ExpenseError('Escribe el nombre del gasto.')
  const amount = Math.round(Number(body?.amount))
  if (!Number.isFinite(amount) || amount <= 0 || amount > 5_000_000) throw new ExpenseError('Escribe el monto del gasto, en pesos.')
  if (body?.payment !== 'contado' && body?.payment !== 'credito') throw new ExpenseError('Indica cómo se pagó: contado o crédito.')
  const docNumber = normalizeDocNumber(body?.docNumber)
  if (docNumber && (await findExpensesByDocNumber(docNumber)).some((e) => e.amount === amount)) {
    throw new ExpenseError(`Ya hay un gasto rendido con el N° ${docNumber} por ese mismo monto.`, 409)
  }

  const { data: doc } = await supabaseAdmin.from('documents').select('id, kind, uploaded_by_type, uploaded_by_label, booking_id').eq('id', id).maybeSingle()
  if (!doc || doc.uploaded_by_type !== 'trabajador') throw new ExpenseError('Archivo no encontrado', 404)
  if (doc.kind === 'gasto') throw new ExpenseError('Ese archivo ya es un gasto.', 409)
  if (!doc.booking_id) throw new ExpenseError('Ese archivo no está asociado a un trabajo.')

  const update: Record<string, unknown> = {
    kind: 'gasto',
    note: name,
    amount,
    expense_payment: body.payment,
    expense_status: 'pendiente',
    ...(docNumber ? { doc_number: docNumber } : {}),
  }
  // La condición `kind <> gasto` va también en el UPDATE: un doble clic no lo convierte dos veces.
  const { data: changed, error } = await supabaseAdmin.from('documents').update(update).eq('id', id).neq('kind', 'gasto').select('id').maybeSingle()
  if (error) throw new ExpenseError('No se pudo guardar el gasto.', 500)
  if (!changed) throw new ExpenseError('Ese archivo ya es un gasto.', 409)
  void actor
  return { name, amount, workerLabel: doc.uploaded_by_label || 'Trabajador' }
}
