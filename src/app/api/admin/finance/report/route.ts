import { NextRequest, NextResponse } from 'next/server'
import { getActorFromRequest, logAdminAction } from '@/lib/activityLog'
import { FinanceReportError, getFinanceReport } from '@/lib/financeReport'
import { SERVICE_FILTER_LABEL } from '@/lib/financeReportTypes'
import { financeReportWorkbook } from '@/lib/financeReportExcel'

export const dynamic = 'force-dynamic'

/**
 * Resumen financiero. `?desde&hasta` (obligatorios), `&servicio=mudanza|domicilio`,
 * `&cliente=empresas|personas|e:<id>|p:<correo>`, `&trabajador=<id>`. Con `&formato=xlsx`
 * devuelve el Excel con esos mismos filtros.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  try {
    const report = await getFinanceReport({
      desde: params.get('desde'),
      hasta: params.get('hasta'),
      servicio: params.get('servicio'),
      cliente: params.get('cliente'),
      trabajador: params.get('trabajador'),
    })
    if (params.get('formato') !== 'xlsx') return NextResponse.json(report)

    const client =
      report.client === '' ? 'Todos' : report.client === 'empresas' ? 'Solo empresas' : report.client === 'personas' ? 'Solo personas' : report.options.clients.find((c) => c.value === report.client)?.label || report.client
    const worker = report.workerId ? report.options.workers.find((w) => w.id === report.workerId)?.name || report.workerId : 'Todos'
    const buffer = await financeReportWorkbook(report, { client, worker })
    await logAdminAction({
      actor: getActorFromRequest(request),
      action: 'finance.report_exported',
      entityType: 'settings',
      entityLabel: 'Resumen financiero',
      summary: `Descargó el resumen financiero del ${report.from} al ${report.to} (servicio: ${SERVICE_FILTER_LABEL[report.service]}, cliente: ${client}, trabajador: ${worker})`,
      request,
    })
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="resumen_financiero_${report.from}_${report.to}.xlsx"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    if (error instanceof FinanceReportError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('[admin/finance/report] Error:', error)
    return NextResponse.json({ error: 'No se pudo armar el resumen' }, { status: 500 })
  }
}
