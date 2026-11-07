import ExcelJS from 'exceljs'
import { CLOSING_UNIT_LABEL, tariffSummary, type ClosingSnapshot } from '@/lib/companyClosingTypes'

const CLP = '"$"#,##0;-"$"#,##0'
const UF = '#,##0.00##" UF"'
const ddmmyyyy = (d: string) => d.slice(0, 10).split('-').reverse().join('-')

/** El cierre de una empresa en Excel: encabezado con la tarifa y una fila por trabajo. */
export async function companyClosingWorkbook(snapshot: ClosingSnapshot, savedAt?: string | null): Promise<ArrayBuffer> {
  const inUf = snapshot.tariff.currency === 'UF'
  const wb = new ExcelJS.Workbook()
  const sheet = wb.addWorksheet('Cierre')
  const head = (label: string, value: string | number) => {
    const row = sheet.addRow([label, value])
    row.getCell(1).font = { bold: true }
  }
  head('Empresa', `${snapshot.company.razonSocial} (${snapshot.company.rut})`)
  head('Período', `${ddmmyyyy(snapshot.from)} al ${ddmmyyyy(snapshot.to)}`)
  head('Tarifa', tariffSummary(snapshot.tariff))
  if (inUf) {
    head(
      'Pesos',
      snapshot.uf
        ? `Referenciales, con UF $${snapshot.uf.value.toLocaleString('es-CL', { maximumFractionDigits: 2 })} (${ddmmyyyy(snapshot.uf.date)}). Los definitivos se fijan al facturar, con la UF del día de la factura.`
        : 'Se fijan al facturar, con la UF del día de la factura.'
    )
  }
  head('Estado', savedAt ? 'Cerrado' : 'Borrador (sin cerrar)')
  sheet.addRow([])

  const header = sheet.addRow([
    'Fecha',
    'Código',
    'Solicitado por',
    'Cliente',
    'Se cobra por',
    'Pallets',
    'Kilos',
    'Tramos',
    'Urgente',
    'Repaletizado',
    'N° OD',
    'N° guía o factura',
    'Foto recepción',
    inUf ? 'Neto UF' : 'Neto',
    inUf ? 'Neto $ (referencial)' : 'Neto $',
    'Falta',
    'Observaciones',
  ])
  header.font = { bold: true }
  for (const r of snapshot.rows) {
    sheet.addRow([
      ddmmyyyy(r.date),
      r.code || '',
      r.requestedBy,
      r.customer ?? '',
      CLOSING_UNIT_LABEL[r.unit],
      r.pallets ?? '',
      r.kg ?? '',
      r.tramos,
      r.urgent ? 'Sí' : 'No',
      r.repalletize ? 'Sí' : 'No',
      r.odNumber || '',
      r.guideNumber || '',
      r.receptionPhotos.length > 0 ? `Sí (${r.receptionPhotos.length})` : 'No',
      r.net,
      r.netClp,
      r.missing.join(', '),
      r.note || '',
    ])
  }
  const total = sheet.addRow([
    'TOTAL',
    `${snapshot.totals.jobs} trabajos`,
    '',
    '',
    '',
    snapshot.totals.pallets,
    snapshot.totals.kg,
    snapshot.totals.tramos,
    snapshot.totals.urgentCount,
    snapshot.totals.repalletizeCount ?? 0,
    '',
    '',
    '',
    snapshot.totals.net,
    snapshot.totals.netClp,
    snapshot.totals.incomplete > 0 ? `${snapshot.totals.incomplete} con datos incompletos` : '',
  ])
  total.font = { bold: true }
  sheet.getColumn(14).numFmt = inUf ? UF : CLP
  sheet.getColumn(15).numFmt = CLP
  const widths = [12, 12, 26, 26, 12, 9, 9, 8, 9, 12, 14, 18, 14, 12, 18, 36]
  widths.forEach((w, i) => (sheet.getColumn(i + 1).width = w))
  sheet.addRow([])
  if (snapshot.totals.repalletizeCount) {
    sheet.addRow([
      `Repaletizado: ${snapshot.totals.repalletizeCount} × $${Math.round(snapshot.repalletizePrice || 0).toLocaleString('es-CL')} = $${Math.round(snapshot.totals.repalletizeClp || 0).toLocaleString('es-CL')} neto, aparte.`,
    ])
  }
  sheet.addRow(['Montos netos: la factura agrega IVA.'])
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer
}
