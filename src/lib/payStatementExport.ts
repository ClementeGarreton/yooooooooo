/**
 * Descarga del detalle de pago: CSV consolidado y PDF con una página por funcionario.
 * Corre en el navegador (lo usa el panel de cierre). No calcula nada: escribe el
 * `PayStatement` que ya armó el servidor, para que el archivo diga lo mismo que la pantalla.
 */

import jsPDF from 'jspdf'
import type { PayStatement } from '@/lib/workerPayTypes'

const day = (d: string) => d.slice(0, 10).split('-').reverse().join('-')
const clp = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(Math.round(n)).toLocaleString('es-CL')}`
const KIND_LABEL = { trabajo: 'Trabajo', gasto: 'Gasto', ajuste: 'Ajuste', base: 'Sueldo base' } as const
const weekday = (d: string) => {
  const [y, m, dd] = d.slice(0, 10).split('-').map(Number)
  const name = new Date(y, m - 1, dd).toLocaleDateString('es-CL', { weekday: 'long' })
  return name.charAt(0).toUpperCase() + name.slice(1)
}

/**
 * Las líneas agrupadas por día, en orden, con el total de cada día (Tomás, 21-10-2026:
 * «además de los trabajos, destacar cada día con su total diario»).
 */
export function linesByDay(lines: PayStatement['lines']): { date: string; lines: PayStatement['lines']; total: number }[] {
  const out: { date: string; lines: PayStatement['lines']; total: number }[] = []
  for (const l of [...lines].sort((a, b) => a.date.localeCompare(b.date))) {
    const key = l.date.slice(0, 10)
    const last = out[out.length - 1]
    if (last && last.date === key) {
      last.lines.push(l)
      last.total += l.amount
    } else out.push({ date: key, lines: [l], total: l.amount })
  }
  return out
}

export interface StatementToExport {
  statement: PayStatement
  /** Glosa que acompaña el detalle. */
  note: string | null
  /** Pagos ya registrados en el período. */
  paid: number
  /** Cerrado por quién y cuándo; null = período abierto (borrador). */
  closed: { by: string | null; at: string } | null
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

const fileStamp = (items: StatementToExport[]) => `${items[0].statement.from}_${items[0].statement.to}`

/** Una fila por línea de detalle, más una de total por funcionario. Abre en Excel. */
export function downloadStatementsCsv(items: StatementToExport[]) {
  if (items.length === 0) return
  const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const header = ['Funcionario', 'Código', 'Desde', 'Hasta', 'Estado', 'Fecha', 'Tipo', 'Concepto', 'Detalle', 'Monto', 'Glosa']
  const rows: unknown[][] = []
  for (const { statement: s, note, paid, closed } of items) {
    const state = closed ? 'Cerrado' : 'Abierto'
    for (const group of linesByDay(s.lines)) {
      for (const l of group.lines) rows.push([s.name, s.code, day(s.from), day(s.to), state, day(l.date), KIND_LABEL[l.kind], l.label, l.detail, l.amount, ''])
      rows.push([s.name, s.code, day(s.from), day(s.to), state, day(group.date), 'Total del día', `${weekday(group.date)} ${day(group.date)}`, `${group.lines.length} línea${group.lines.length === 1 ? '' : 's'}`, group.total, ''])
    }
    rows.push([s.name, s.code, day(s.from), day(s.to), state, '', 'Total', `${s.jobsCount} trabajos`, `Trabajos ${s.jobsTotal} · Gastos ${s.expensesTotal} · Ajustes ${s.adjustmentsTotal}${s.baseTotal ? ` · Base ${s.baseTotal}` : ''}`, s.total, note || ''])
    rows.push([s.name, s.code, day(s.from), day(s.to), state, '', 'Pagado', '', '', paid, ''])
    rows.push([s.name, s.code, day(s.from), day(s.to), state, '', 'Saldo', '', '', s.total - paid, ''])
  }
  // BOM para que Excel lea las tildes; «;» no hace falta porque los campos van entre comillas.
  const csv = '﻿' + [header.map(cell).join(','), ...rows.map((r) => r.map(cell).join(','))].join('\n')
  download(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), `cierre_pagos_${fileStamp(items)}.csv`)
}

/** Una página (o más, si no cabe) por funcionario, con su glosa: lista para enviársela. */
export function downloadStatementsPdf(items: StatementToExport[]) {
  if (items.length === 0) return
  buildStatementsPdf(items).save(`cierre_pagos_${fileStamp(items)}.pdf`)
}

/**
 * El PDF del detalle, sin descargarlo. Lo usa también el servidor para mandarlo por correo
 * (workerPayEmail.ts): el adjunto es el mismo archivo que se descarga.
 */
export function buildStatementsPdf(items: StatementToExport[]): jsPDF {
  const pdf = new jsPDF('p', 'mm', 'a4')
  const width = pdf.internal.pageSize.getWidth()
  const left = 16
  const right = width - 16
  const bottom = 280

  items.forEach(({ statement: s, note, paid, closed }, index) => {
    if (index > 0) pdf.addPage()
    let y = 20
    const need = (h: number) => {
      if (y + h > bottom) {
        pdf.addPage()
        y = 20
      }
    }

    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(15)
    pdf.setTextColor(20, 20, 20)
    pdf.text('Detalle de pago', left, y)
    pdf.setFontSize(9)
    pdf.setFont('helvetica', 'normal')
    pdf.setTextColor(110, 110, 110)
    pdf.text('Yo Me Encargo', right, y, { align: 'right' })
    y += 8
    pdf.setFontSize(12)
    pdf.setTextColor(20, 20, 20)
    pdf.setFont('helvetica', 'bold')
    pdf.text(`${s.name} · ${s.code}`, left, y)
    y += 6
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(10)
    pdf.text(`Período: ${day(s.from)} al ${day(s.to)}`, left, y)
    pdf.text(closed ? `Cerrado el ${day(closed.at)}${closed.by ? ` por ${closed.by}` : ''}` : 'Borrador: período sin cerrar', right, y, { align: 'right' })
    y += 5
    pdf.text(`Forma de pago: ${s.ruleLabel}`, left, y)
    y += 8

    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(9)
    pdf.setFillColor(240, 240, 240)
    pdf.rect(left, y - 4, right - left, 6, 'F')
    pdf.text('Fecha', left + 1, y)
    pdf.text('Tipo', left + 22, y)
    pdf.text('Concepto', left + 40, y)
    pdf.text('Monto', right - 1, y, { align: 'right' })
    y += 6

    pdf.setFont('helvetica', 'normal')
    if (s.lines.length === 0) {
      pdf.text('Sin movimientos en el período.', left + 1, y)
      y += 6
    }
    for (const group of linesByDay(s.lines)) {
      // Cada día destacado, con su total a la derecha.
      need(12)
      pdf.setFillColor(228, 238, 250)
      pdf.rect(left, y - 4, right - left, 6, 'F')
      pdf.setFont('helvetica', 'bold')
      pdf.text(`${weekday(group.date)} ${day(group.date)}`, left + 1, y)
      pdf.text(`Total del día: ${clp(group.total)}`, right - 1, y, { align: 'right' })
      pdf.setFont('helvetica', 'normal')
      y += 6
      for (const l of group.lines) {
        const concept = pdf.splitTextToSize([l.label, l.detail].filter(Boolean).join(' — '), right - left - 70) as string[]
        need(concept.length * 4.2 + 2)
        pdf.text(day(l.date), left + 1, y)
        pdf.text(KIND_LABEL[l.kind], left + 22, y)
        pdf.text(concept, left + 40, y)
        pdf.text(clp(l.amount), right - 1, y, { align: 'right' })
        y += concept.length * 4.2 + 1.8
      }
      y += 1
    }

    need(40)
    y += 2
    pdf.setDrawColor(200, 200, 200)
    pdf.line(left, y, right, y)
    y += 6
    const total = (label: string, value: number, bold = false) => {
      pdf.setFont('helvetica', bold ? 'bold' : 'normal')
      pdf.setFontSize(bold ? 11 : 10)
      pdf.text(label, right - 60, y)
      pdf.text(clp(value), right - 1, y, { align: 'right' })
      y += bold ? 7 : 5.5
    }
    total(`Trabajos (${s.jobsCount})`, s.jobsTotal)
    total('Gastos por reembolsar', s.expensesTotal)
    total('Bonificaciones y ajustes', s.adjustmentsTotal)
    if (s.baseTotal) total('Sueldo base', s.baseTotal)
    total('Total del período', s.total, true)
    total('Pagado', paid)
    total('Saldo', s.total - paid, true)

    if (note) {
      const text = pdf.splitTextToSize(note, right - left) as string[]
      need(text.length * 4.5 + 10)
      y += 3
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(10)
      pdf.text('Glosa', left, y)
      y += 5
      pdf.setFont('helvetica', 'normal')
      pdf.text(text, left, y)
    }
  })
  return pdf
}
