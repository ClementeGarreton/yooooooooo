import { NextRequest, NextResponse } from 'next/server'
import ExcelJS from 'exceljs'
import { getActorFromRequest, logAdminAction } from '@/lib/activityLog'
import { WorkerPayError, buildBankPayroll } from '@/lib/workerPay'
import { BANK_PAYROLL_CSV_HEADER, BANK_PAYROLL_HEADERS, bankPayrollCsvLine } from '@/lib/workerPayTypes'

export const dynamic = 'force-dynamic'

/**
 * Nómina para el banco del período (`?desde=AAAA-MM-DD&hasta=AAAA-MM-DD`): un CSV con las
 * 13 columnas del ejemplo de BancoEstado (separado por «;», ASCII), una fila por funcionario
 * con saldo por pagar. Con `&formato=xlsx`, el mismo contenido en Excel.
 * Con `?resumen=1` devuelve solo cuántos entran, el total y quiénes quedan fuera, sin el archivo.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  try {
    const payroll = await buildBankPayroll(params.get('desde'), params.get('hasta'))
    if (params.get('resumen') === '1') {
      return NextResponse.json({ from: payroll.from, to: payroll.to, count: payroll.rows.length, total: payroll.total, skipped: payroll.skipped })
    }
    if (payroll.rows.length === 0) throw new WorkerPayError('No hay a quién pagar en este período con los datos bancarios completos.', 409)

    const log = () =>
      logAdminAction({
        actor: getActorFromRequest(request),
        action: 'worker_pay.payroll_exported',
        entityType: 'settings',
        entityLabel: 'Nómina del banco',
        summary: `Descargó la nómina del banco del ${payroll.from} al ${payroll.to}: ${payroll.rows.length} pagos por $${payroll.total.toLocaleString('es-CL')}`,
        request,
      })

    if (params.get('formato') !== 'xlsx') {
      const csv = [BANK_PAYROLL_CSV_HEADER, ...payroll.rows.map(bankPayrollCsvLine)].join('\n') + '\n'
      await log()
      return new NextResponse(csv, {
        headers: {
          'Content-Type': 'text/csv; charset=us-ascii',
          'Content-Disposition': `attachment; filename="nomina_banco_${payroll.from}_${payroll.to}.csv"`,
          'Cache-Control': 'no-store',
        },
      })
    }

    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('Nómina')
    sheet.addRow([...BANK_PAYROLL_HEADERS])
    for (const row of payroll.rows) sheet.addRow(row)
    sheet.columns.forEach((column, i) => {
      column.width = Math.max(14, BANK_PAYROLL_HEADERS[i].length + 2)
    })
    const buffer = await workbook.xlsx.writeBuffer()

    await log()
    return new NextResponse(buffer as ArrayBuffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="nomina_banco_${payroll.from}_${payroll.to}.xlsx"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    if (error instanceof WorkerPayError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('[admin/worker-pay/nomina] Error:', error)
    return NextResponse.json({ error: 'No se pudo armar la nómina' }, { status: 500 })
  }
}
