import { NextRequest, NextResponse } from 'next/server'
import { getActorFromRequest, logAdminAction } from '@/lib/activityLog'
import { hasAdminAction } from '@/lib/adminPermissions'
import { CompanyClosingError, getCompanyClosing, getSavedClosing, reopenCompanyClosing, saveCompanyClosing } from '@/lib/companyClosing'
import { companyClosingWorkbook } from '@/lib/companyClosingExcel'

export const dynamic = 'force-dynamic'

const fail = (error: unknown, fallback: string) => {
  if (error instanceof CompanyClosingError) return NextResponse.json({ error: error.message }, { status: error.status })
  console.error('[admin/companies/closing] Error:', error)
  return NextResponse.json({ error: fallback }, { status: 500 })
}
const day = (d: string) => d.split('-').reverse().join('-')

/**
 * Cierre de la empresa en un período: `?desde&hasta[&uf=]`. Con `&formato=xlsx`, el Excel.
 * Con `?cierre=<id>&formato=xlsx`, el Excel de un cierre guardado, tal como quedó; con
 * `?cierre=<id>&formato=json`, su detalle, para armar el PDF en el navegador.
 */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const q = request.nextUrl.searchParams
  try {
    const closingId = q.get('cierre')
    if (closingId) {
      const snapshot = await getSavedClosing(params.id, closingId)
      if (q.get('formato') === 'json') return NextResponse.json(snapshot)
      const buffer = await companyClosingWorkbook(snapshot, 'cerrado')
      return excel(buffer, `cierre_${snapshot.company.code}_${snapshot.from}_${snapshot.to}.xlsx`)
    }
    const data = await getCompanyClosing(params.id, q.get('desde'), q.get('hasta'), q.get('uf'))
    if (q.get('formato') !== 'xlsx') return NextResponse.json(data)
    return excel(await companyClosingWorkbook(data, null), `cierre_borrador_${data.company.code}_${data.from}_${data.to}.xlsx`)
  } catch (error) {
    return fail(error, 'No se pudo armar el cierre')
  }
}

function excel(buffer: ArrayBuffer, name: string) {
  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'no-store',
    },
  })
}

/** Guarda el cierre. Body: `{ from, to, uf? }`. */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const actor = getActorFromRequest(request)
  try {
    const { name, snapshot } = await saveCompanyClosing(params.id, await request.json().catch(() => ({})), actor?.username || 'administrador')
    await logAdminAction({
      actor,
      action: 'company.period_closed',
      entityType: 'company',
      entityId: params.id,
      entityLabel: name,
      summary: `Cerró ${name} del ${day(snapshot.from)} al ${day(snapshot.to)}: ${snapshot.totals.jobs} trabajos, ${snapshot.tariff.currency === 'UF' ? `${snapshot.totals.net.toLocaleString('es-CL')} UF netas` : `$${snapshot.totals.net.toLocaleString('es-CL')} neto`}`,
      request,
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return fail(error, 'No se pudo guardar el cierre')
  }
}

/** Reabre un cierre. `?id=`. Solo el perfil Administrador. */
export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const actor = getActorFromRequest(request)
  try {
    if (!(await hasAdminAction(request, 'users.manage'))) {
      return NextResponse.json({ error: 'Solo un Administrador puede reabrir un cierre.' }, { status: 403 })
    }
    const result = await reopenCompanyClosing(params.id, request.nextUrl.searchParams.get('id'), actor?.username || 'administrador')
    await logAdminAction({
      actor,
      action: 'company.period_reopened',
      entityType: 'company',
      entityId: params.id,
      entityLabel: result.name,
      summary: `Reabrió el cierre de ${result.name} del ${day(result.from)} al ${day(result.to)}`,
      request,
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return fail(error, 'No se pudo reabrir el cierre')
  }
}
