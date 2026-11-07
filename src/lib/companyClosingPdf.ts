/**
 * PDF del cierre de una empresa, con el formato del que arma Tomás a mano para Monfiza
 * («Cierre Agosto 2026 Monfiza final.pdf», 21-10-2026):
 *   1. Tabla de despachos: N°, cliente, OD, guía o factura, pallets (o kilos), N° de cobros,
 *      observaciones y fecha.
 *   2. Detalle de cobro: tarifa, despachos con 1 cobro, con más de un cobro, urgencias,
 *      repaletizado y total.
 *   3. Respaldo fotográfico: las fotos de cada despacho, una por página.
 *
 * Se arma en el navegador (jsPDF, como la orden de trabajo). Las fotos se bajan de la ruta
 * del admin y se achican antes de ponerlas, para que el PDF no pese decenas de MB.
 */

import jsPDF from 'jspdf'
import type { ClosingSnapshot } from '@/lib/companyClosingTypes'

const day = (d: string) => {
  const [y, m, dd] = d.slice(0, 10).split('-')
  return `${Number(dd)}-${Number(m)}-${y.slice(2)}`
}
const fmtUf = (n: number) => `${n.toLocaleString('es-CL', { maximumFractionDigits: 4 })} UF`
const fmtClp = (n: number) => `$${Math.round(n).toLocaleString('es-CL')}`
const fmtTariff = (n: number, currency: 'UF' | 'CLP') => (currency === 'UF' ? fmtUf(n) : fmtClp(n))

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

/** «Cierre de Mes - Agosto 2026» si es un mes completo; si no (una semana, p. ej.), las fechas. */
function periodTitle(from: string, to: string): string {
  const [fy, fm, fd] = from.split('-').map(Number)
  const [ty, tm, td] = to.split('-').map(Number)
  const lastDay = new Date(ty, tm, 0).getDate()
  if (fy === ty && fm === tm && fd === 1 && td === lastDay) {
    const name = MONTHS[fm - 1]
    return `Cierre de Mes - ${name.charAt(0).toUpperCase()}${name.slice(1)} ${fy}`
  }
  return `Cierre del ${day(from)} al ${day(to)}`
}

/** Baja una foto del admin y la achica a JPEG. null si no es una imagen o no se pudo leer. */
async function loadImage(documentId: string): Promise<{ data: string; width: number; height: number } | null> {
  try {
    const res = await fetch(`/api/admin/documents/${documentId}`)
    if (!res.ok) return null
    const blob = await res.blob()
    if (!blob.type.startsWith('image/')) return null
    const bitmap = await createImageBitmap(blob)
    const scale = Math.min(1, 1400 / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    return { data: canvas.toDataURL('image/jpeg', 0.6), width: canvas.width, height: canvas.height }
  } catch {
    return null
  }
}

export async function buildCompanyClosingPdf(snapshot: ClosingSnapshot, onProgress?: (text: string) => void): Promise<Blob> {
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' })
  const pageW = pdf.internal.pageSize.getWidth()
  const pageH = pdf.internal.pageSize.getHeight()
  const margin = 14
  let y = margin

  const newPageIfNeeded = (needed: number) => {
    if (y + needed > pageH - margin) {
      pdf.addPage()
      y = margin
    }
  }

  // ── Título ──
  pdf.setFont('helvetica', 'normal')
  pdf.setTextColor(44, 99, 160)
  pdf.setFontSize(18)
  pdf.text(periodTitle(snapshot.from, snapshot.to), margin, y + 6)
  y += 12
  pdf.setTextColor(0, 0, 0)
  pdf.setFontSize(10)
  pdf.text(`Cliente: ${snapshot.company.razonSocial}`, margin, y)
  y += 6

  // ── Tabla de despachos ──
  const unitLabel = (r: ClosingSnapshot['rows'][number]) =>
    r.unit === 'kg' ? (r.kg !== null ? `${r.kg.toLocaleString('es-CL')} kg` : '—') : r.pallets !== null ? String(r.pallets) : '—'
  const observations = (r: ClosingSnapshot['rows'][number]) =>
    [r.note ? (/[.!?]$/.test(r.note) ? r.note : `${r.note}.`) : null, r.urgent ? 'Urgencia.' : null, r.repalletize ? 'Se repaletizó.' : null, r.tramos > 1 ? `${r.tramos} cobros.` : null, r.missing.length ? `Falta: ${r.missing.join(', ')}.` : null]
      .filter(Boolean)
      .join(' ')
  // Del más nuevo al más antiguo, como el cierre de Tomás.
  const rows = [...snapshot.rows].sort((a, b) => b.date.localeCompare(a.date))
  const columns = [
    { title: 'N°', w: 8 },
    { title: 'Cliente', w: 34 },
    { title: 'OD', w: 16 },
    { title: 'Guía o Factura', w: 24 },
    { title: 'N° Pallets', w: 17 },
    { title: 'N° Cobros', w: 15 },
    { title: 'Observaciones', w: 50 },
    { title: 'Fecha', w: 18 },
  ]
  const lineH = 3.6
  const drawRow = (cells: string[], header = false, highlight = false) => {
    pdf.setFont('helvetica', header ? 'bold' : 'normal')
    pdf.setFontSize(8)
    const wrapped = cells.map((c, i) => pdf.splitTextToSize(c || '', columns[i].w - 2) as string[])
    const h = Math.max(...wrapped.map((w) => w.length)) * lineH + 2
    newPageIfNeeded(h)
    let x = margin
    wrapped.forEach((lines, i) => {
      if (header) pdf.setFillColor(220, 220, 220)
      else if (highlight) pdf.setFillColor(255, 243, 176)
      if (header || highlight) pdf.rect(x, y, columns[i].w, h, 'F')
      pdf.rect(x, y, columns[i].w, h)
      pdf.text(lines, x + 1, y + lineH)
      x += columns[i].w
    })
    y += h
  }
  drawRow(columns.map((c) => c.title), true)
  rows.forEach((r, i) =>
    drawRow(
      [String(i + 1), r.customer || r.requestedBy || '—', r.odNumber || '-', r.guideNumber || '—', unitLabel(r), String(r.tramos), observations(r), day(r.date)],
      false,
      r.missing.length > 0
    )
  )
  y += 6

  // ── Detalle de cobro ──
  const t = snapshot.tariff
  const text = (value: string, opts: { bold?: boolean; size?: number; indent?: number } = {}) => {
    pdf.setFont('helvetica', opts.bold ? 'bold' : 'normal')
    pdf.setFontSize(opts.size || 10)
    const lines = pdf.splitTextToSize(value, pageW - margin * 2 - (opts.indent || 0)) as string[]
    newPageIfNeeded(lines.length * 5)
    pdf.text(lines, margin + (opts.indent || 0), y + 4)
    y += lines.length * 5
  }
  newPageIfNeeded(20)
  pdf.setTextColor(44, 99, 160)
  text('Detalle de cobro', { size: 14 })
  pdf.setTextColor(0, 0, 0)
  y += 1
  text('Tarifas (valores netos, más IVA)', { bold: true })
  if (t.tramoPrice !== null) {
    const size = [t.tramoPallets ? `${t.tramoPallets} pallets` : null, t.tramoKg ? `${t.tramoKg.toLocaleString('es-CL')} kg` : null].filter(Boolean).join(' o ')
    text(`Despacho: ${fmtTariff(t.tramoPrice, t.currency)} por cobro, hasta ${size}. Sobre ese límite se cobra otro tramo.`, { indent: 6 })
  }
  if (t.urgencyPrice !== null) text(`Urgencia: ${fmtTariff(t.urgencyPrice, t.currency)} por despacho.`, { indent: 6 })
  y += 2

  const numbered = rows.map((r, i) => ({ r, n: i + 1 }))
  const single = numbered.filter((x) => x.r.tramos === 1)
  const multi = numbered.filter((x) => x.r.tramos > 1)
  const urgent = numbered.filter((x) => x.r.urgent)
  const repal = numbered.filter((x) => x.r.repalletize)
  const list = (xs: typeof numbered) => xs.map((x) => x.n).join(', ')
  const price = t.tramoPrice || 0
  let section = 1
  if (single.length) {
    text(`${section++}. Despachos con 1 cobro`, { bold: true })
    text(`N° ${list(single)}.`, { indent: 6 })
    text(`${single.length} cobros × ${fmtTariff(price, t.currency)} = ${fmtTariff(single.length * price, t.currency)}`, { indent: 6 })
  }
  if (multi.length) {
    const cobros = multi.reduce((s, x) => s + x.r.tramos, 0)
    text(`${section++}. Despachos con más de un cobro`, { bold: true })
    text(multi.map((x) => `N° ${x.n} ${x.r.customer || x.r.requestedBy || ''} (${unitLabel(x.r)}${x.r.unit === 'pallets' ? ' pallets' : ''}: ${x.r.tramos} cobros)`).join(', ') + '.', { indent: 6 })
    text(`${cobros} cobros × ${fmtTariff(price, t.currency)} = ${fmtTariff(cobros * price, t.currency)}`, { indent: 6 })
  }
  if (urgent.length) {
    text(`${section++}. Urgencias`, { bold: true })
    text(urgent.map((x) => `N° ${x.n}${x.r.odNumber ? ` (OD ${x.r.odNumber})` : ''}`).join(', ') + '.', { indent: 6 })
    text(`${urgent.length} × ${fmtTariff(t.urgencyPrice || 0, t.currency)} = ${fmtTariff(urgent.length * (t.urgencyPrice || 0), t.currency)}`, { indent: 6 })
  }
  if (repal.length) {
    text(`${section++}. Repaletizado`, { bold: true })
    const each = snapshot.repalletizePrice || 0
    text(
      repal.map((x) => `N° ${x.n}${x.r.odNumber ? ` (OD ${x.r.odNumber})` : ''}`).join(', ') +
        (each > 0 ? `: ${repal.length} × ${fmtClp(each)} = ${fmtClp(snapshot.totals.repalletizeClp || 0)}.` : ': monto sin definir en Configuración → Precios.'),
      { indent: 6 }
    )
  }
  y += 2
  const totalCobros = rows.reduce((s, r) => s + r.tramos, 0)
  const repalText = snapshot.totals.repalletizeClp ? `, más ${fmtClp(snapshot.totals.repalletizeClp)} de repaletizado` : ''
  text(`Total: ${fmtTariff(snapshot.totals.net, t.currency)} + IVA${repalText}`, { bold: true })
  text(
    `(${rows.length} despachos, ${totalCobros} cobros: ${fmtTariff(totalCobros * price, t.currency)}; urgencias: ${fmtTariff(urgent.length * (t.urgencyPrice || 0), t.currency)})`,
    { indent: 6 }
  )
  if (t.currency === 'UF' && snapshot.uf) {
    text(`Referencia en pesos con UF ${fmtClp(snapshot.uf.value)} del ${day(snapshot.uf.date)}: ${fmtClp(snapshot.totals.netClp)} neto. Los pesos se fijan al facturar.`, { indent: 6, size: 9 })
  }

  // ── Respaldo fotográfico ──
  const withPhotos = numbered.filter((x) => x.r.receptionPhotos.length > 0)
  let first = true
  for (const { r, n } of withPhotos) {
    for (const [k, photo] of r.receptionPhotos.entries()) {
      onProgress?.(`Agregando fotos: despacho N° ${n}`)
      const img = await loadImage(photo.id)
      pdf.addPage()
      y = margin
      if (first) {
        pdf.setTextColor(44, 99, 160)
        text('Respaldo fotográfico', { size: 14 })
        pdf.setTextColor(0, 0, 0)
        first = false
      }
      text(`N° ${n}${r.receptionPhotos.length > 1 ? ` (${k + 1} de ${r.receptionPhotos.length})` : ''} · ${r.customer || r.requestedBy || ''} · ${day(r.date)}`, { bold: true })
      if (!img) {
        text(`Archivo «${photo.fileName}»: no es una imagen; se ve en el panel.`, { size: 9 })
        continue
      }
      const maxW = pageW - margin * 2
      const maxH = pageH - y - margin
      const ratio = Math.min(maxW / img.width, maxH / img.height)
      const w = img.width * ratio
      const h = img.height * ratio
      pdf.addImage(img.data, 'JPEG', margin + (maxW - w) / 2, y + 2, w, h)
    }
  }

  return pdf.output('blob')
}
