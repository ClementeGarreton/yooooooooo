import { NextRequest, NextResponse } from 'next/server'
import { getActorFromRequest, logAdminAction } from '@/lib/activityLog'
import { WorkerPayError, getPayConfig, savePayConfig } from '@/lib/workerPay'
import { configRule, payRuleLabel } from '@/lib/workerPayTypes'

export const dynamic = 'force-dynamic'

/** Regla general de pago a trabajadores. */
export async function GET() {
  return NextResponse.json(await getPayConfig())
}

/** Guarda la regla general. Body: `{ mode: 'fijo' | 'porcentaje' | 'm3km', value, perM3, perKm, perPallet?, originAccountType?, originAccountNumber? }`. */
export async function PUT(request: NextRequest) {
  const actor = getActorFromRequest(request)
  try {
    const before = await getPayConfig()
    const config = await savePayConfig(await request.json().catch(() => ({})), actor?.username || 'administrador')
    await logAdminAction({
      actor,
      action: 'worker_pay.config_updated',
      entityType: 'settings',
      entityLabel: 'Pago a trabajadores',
      summary: 'Cambió la regla general de pago a trabajadores',
      changes: {
        regla: { from: payRuleLabel(configRule(before)), to: payRuleLabel(configRule(config)) },
        ...(before.perPallet !== config.perPallet ? { 'pesos por pallet': { from: String(before.perPallet ?? '—'), to: String(config.perPallet ?? '—') } } : {}),
        // El número de la cuenta de origen no se copia al registro: solo que cambió.
        ...(before.originAccountType !== config.originAccountType || before.originAccountNumber !== config.originAccountNumber
          ? { 'cuenta de origen': { from: before.originAccountNumber ? `${before.originAccountType || ''} cargada` : '—', to: config.originAccountNumber ? `${config.originAccountType || ''} nueva` : '—' } }
          : {}),
      },
      request,
    })
    return NextResponse.json({ ok: true, config })
  } catch (error) {
    if (error instanceof WorkerPayError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('[admin/worker-pay/config] Error:', error)
    return NextResponse.json({ error: 'No se pudo guardar la regla' }, { status: 500 })
  }
}
