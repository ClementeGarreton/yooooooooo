import { NextRequest, NextResponse } from 'next/server'
import { getActorFromRequest, logAdminAction } from '@/lib/activityLog'
import { hasAdminAction } from '@/lib/adminPermissions'
import { CreditError, resolveWithdrawal } from '@/lib/referralCredits'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Marca un retiro como transferido o lo rechaza. Body: `{ decision: 'pagado' | 'rechazado', note? }`. */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  if (!(await hasAdminAction(request, 'marketing.manage'))) {
    return NextResponse.json({ error: 'Tu perfil no tiene permiso para resolver retiros de créditos.' }, { status: 403 })
  }
  if (!UUID_RE.test(params.id)) return NextResponse.json({ error: 'Retiro no encontrado' }, { status: 404 })
  const body = await request.json().catch(() => ({}))
  if (body?.decision !== 'pagado' && body?.decision !== 'rechazado') {
    return NextResponse.json({ error: 'Decisión inválida' }, { status: 400 })
  }
  const actor = getActorFromRequest(request)
  try {
    const result = await resolveWithdrawal({ id: params.id, decision: body.decision, note: body.note, actor: actor?.username || 'administrador' })
    const monto = `$${result.amount.toLocaleString('es-CL')}`
    await logAdminAction({
      actor,
      action: body.decision === 'pagado' ? 'credits.withdrawal_paid' : 'credits.withdrawal_rejected',
      entityType: 'customer',
      entityId: result.customerId,
      entityLabel: `Retiro de créditos · ${monto}`,
      summary: body.decision === 'pagado' ? `Marcó como transferido un retiro de ${monto}` : `Rechazó un retiro de ${monto} y devolvió los créditos`,
      request,
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof CreditError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('[admin/credits/withdrawals] Error:', error)
    return NextResponse.json({ error: 'No se pudo guardar' }, { status: 500 })
  }
}
