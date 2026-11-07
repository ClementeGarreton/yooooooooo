import { NextRequest, NextResponse } from 'next/server'
import { getActorFromRequest, logAdminAction } from '@/lib/activityLog'
import { CompanyClosingError, setCompanyTariff } from '@/lib/companyClosing'
import { tariffSummary } from '@/lib/companyClosingTypes'

export const dynamic = 'force-dynamic'

/** Tarifa de cierre de la empresa. Body: `{ closingUnit, currency, tramoPrice, tramoPallets, tramoKg, urgencyPrice }`. */
export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  const actor = getActorFromRequest(request)
  try {
    const result = await setCompanyTariff(params.id, await request.json().catch(() => ({})))
    await logAdminAction({
      actor,
      action: 'company.tariff_changed',
      entityType: 'company',
      entityId: params.id,
      entityLabel: result.name,
      summary: `Cambió la tarifa de cierre de ${result.name}`,
      changes: { tarifa: { from: tariffSummary(result.before), to: tariffSummary(result.after) } },
      request,
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof CompanyClosingError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('[admin/companies/tariff] Error:', error)
    return NextResponse.json({ error: 'No se pudo guardar la tarifa' }, { status: 500 })
  }
}
