import { NextRequest, NextResponse } from 'next/server'
import { getActorFromRequest, logAdminAction } from '@/lib/activityLog'
import { WorkerPayError } from '@/lib/workerPay'
import { emailPayStatements } from '@/lib/workerPayEmail'

export const dynamic = 'force-dynamic'

/** Manda por correo el detalle de pago de períodos cerrados. Body: `{ closingIds: string[] }`. */
export async function POST(request: NextRequest) {
  const actor = getActorFromRequest(request)
  try {
    const body = await request.json().catch(() => ({}))
    const result = await emailPayStatements(body?.closingIds)
    if (result.sent.length > 0) {
      await logAdminAction({
        actor,
        action: 'worker_pay.statement_emailed',
        entityType: 'worker',
        entityLabel: result.sent.map((s) => s.name).join(', '),
        summary: `Mandó por correo el detalle de pago a ${result.sent.map((s) => `${s.name} (${s.email})`).join(', ')}`,
        request,
      })
    }
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    if (error instanceof WorkerPayError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('[admin/worker-pay/email] Error:', error)
    return NextResponse.json({ error: 'No se pudo mandar el correo' }, { status: 500 })
  }
}
