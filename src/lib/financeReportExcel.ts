import ExcelJS from 'exceljs'
import { SERVICE_FILTER_LABEL, type FinanceReport } from '@/lib/financeReportTypes'

const DOC_LABEL = { factura: 'Factura', boleta: 'Boleta', sin_documento: 'Sin documento', sin_definir: 'Sin definir' } as const
const CLP = '"$"#,##0;-"$"#,##0'

/** El resumen en un Excel: hoja Resumen y el detalle (servicios, trabajadores, gastos). */
export async function financeReportWorkbook(report: FinanceReport, filterLabels: { client: string; worker: string }): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook()
  const money = (sheet: ExcelJS.Worksheet, columns: number[]) => columns.forEach((c) => (sheet.getColumn(c).numFmt = CLP))
  const bold = (row: ExcelJS.Row) => (row.font = { bold: true })

  const summary = wb.addWorksheet('Resumen')
  summary.columns = [{ width: 46 }, { width: 18 }]
  const add = (label: string, value: number | string | null = null, strong = false) => {
    const row = summary.addRow([label, value])
    if (strong) bold(row)
  }
  add('Resumen financiero Yo Me Encargo', null, true)
  add('Desde', report.from)
  add('Hasta', report.to)
  add('Servicio', SERVICE_FILTER_LABEL[report.service])
  add('Cliente', filterLabels.client)
  add('Trabajador', filterLabels.worker)
  add('')
  add('INGRESOS', null, true)
  add(`Servicios (${report.income.services})`, report.income.gross)
  add('IVA débito', -report.income.ivaDebito)
  add('Ingresos netos', report.income.net, true)
  add('')
  add('COSTOS', null, true)
  add('Pago a trabajadores por trabajos', -report.costs.workerPay)
  if (!report.filtered) {
    add('Sueldos base', -report.costs.base)
    add('Bonificaciones y descuentos', -report.costs.adjustments)
  }
  if (report.costs.retention > 0) add('Retención boletas de honorarios (la paga la empresa)', -report.costs.retention)
  add('Gastos de terreno (rendidos por trabajadores)', -report.costs.fieldExpenses)
  add('Total costos', -report.costs.total, true)
  add('')
  add('GASTOS DE LA EMPRESA (netos de IVA)', null, true)
  for (const g of report.companyExpenses) add(g.label, -g.net)
  add('Total gastos de la empresa', -report.companyExpensesTotal, true)
  add('')
  add('UTILIDAD', report.result, true)
  add('Rentabilidad (utilidad / ingresos netos)', report.margin === null ? '—' : `${report.margin.toLocaleString('es-CL')} %`, true)
  add('')
  add('IMPUESTOS', null, true)
  add('IVA débito', report.taxes.ivaDebito)
  add('IVA crédito (gastos de la empresa)', report.taxes.ivaCredito)
  add('IVA a pagar', report.taxes.ivaToPay, true)
  add('Retención de honorarios por pagar al SII', report.taxes.honorariosRetention, true)
  add('')
  for (const note of report.notes) add(note)
  money(summary, [2])

  const services = wb.addWorksheet('Servicios')
  services.columns = [
    { header: 'Fecha', width: 12 },
    { header: 'Código', width: 12 },
    { header: 'Cliente', width: 32 },
    { header: 'Servicio', width: 18 },
    { header: 'Documento', width: 14 },
    { header: 'Total con IVA', width: 14 },
    { header: 'IVA', width: 12 },
    { header: 'Neto', width: 14 },
    { header: 'Pago a trabajadores', width: 18 },
    { header: 'Gastos de terreno', width: 16 },
    { header: 'Margen', width: 14 },
    { header: 'Trabajadores', width: 40 },
  ]
  bold(services.getRow(1))
  for (const b of report.bookings) {
    services.addRow([b.date, b.code || '', b.client, SERVICE_FILTER_LABEL[b.service], DOC_LABEL[b.document], b.total, b.iva, b.net, b.workerPay, b.fieldExpenses, b.margin, b.workers.join(', ')])
  }
  money(services, [6, 7, 8, 9, 10, 11])

  const people = wb.addWorksheet('Trabajadores')
  people.columns = [
    { header: 'Trabajador', width: 28 },
    { header: 'Trabajos', width: 10 },
    { header: 'Por trabajos', width: 14 },
    { header: 'Sueldo base', width: 14 },
    { header: 'Bonos y descuentos', width: 18 },
    { header: 'Gastos de terreno', width: 16 },
    { header: '% retención honorarios', width: 20 },
    { header: 'Retención', width: 12 },
  ]
  bold(people.getRow(1))
  for (const w of report.workers) people.addRow([w.name, w.jobs, w.jobsPay, w.base, w.adjustments, w.fieldExpenses, w.honorariosRate ?? '', w.retention])
  money(people, [3, 4, 5, 6, 8])

  if (!report.filtered) {
    const expenses = wb.addWorksheet('Gastos empresa')
    expenses.columns = [
      { header: 'Fecha', width: 12 },
      { header: 'Categoría', width: 24 },
      { header: 'Descripción', width: 36 },
      { header: 'Proveedor', width: 22 },
      { header: 'N° documento', width: 14 },
      { header: 'Total', width: 14 },
      { header: 'IVA', width: 12 },
      { header: 'Neto', width: 14 },
    ]
    bold(expenses.getRow(1))
    for (const e of report.expenses) expenses.addRow([e.date, e.category, e.description, e.provider || '', e.docNumber || '', e.amount, e.iva, e.net])
    money(expenses, [6, 7, 8])
  }

  const field = wb.addWorksheet('Gastos de terreno')
  field.columns = [
    { header: 'Fecha', width: 12 },
    { header: 'Trabajador', width: 28 },
    { header: 'Gasto', width: 36 },
    { header: 'Trabajo', width: 12 },
    { header: 'Monto', width: 14 },
  ]
  bold(field.getRow(1))
  for (const e of report.fieldExpenseList) field.addRow([e.date, e.worker, e.name, e.bookingCode || '', e.amount])
  money(field, [5])

  return (await wb.xlsx.writeBuffer()) as ArrayBuffer
}

