// Tarifa por empresa y cierre por pallets o kg (Monfiza). SIN dependencias de servidor.

export type ClosingUnit = 'pallets' | 'kg'
export type TariffCurrency = 'UF' | 'CLP'

export const CLOSING_UNIT_LABEL: Record<ClosingUnit, string> = { pallets: 'Pallets', kg: 'Kilos' }

/** Nota con que queda marcada la foto de la recepción que sube el trabajador. */
export const RECEPTION_NOTE = 'Foto de recepción'

/**
 * Tarifa de cierre de una empresa (Monfiza, Tomás 19-10-2026): un precio NETO por tramo de
 * hasta N pallets o N kilos (1,28 UF por cada 2 pallets o 1.000 kg; si se pasa, otro tramo),
 * más un recargo NETO por trabajo urgente (0,29 UF). Todo + IVA.
 */
export interface CompanyTariff {
  /** Unidad con que se cierra normalmente. null = la empresa no se cierra por unidad. */
  closingUnit: ClosingUnit | null
  currency: TariffCurrency
  tramoPrice: number | null
  tramoPallets: number | null
  tramoKg: number | null
  urgencyPrice: number | null
}

export interface ClosingRow {
  bookingId: string
  code: string | null
  date: string
  /** Quién pidió el servicio dentro de la empresa (nombre de la reserva). */
  requestedBy: string
  /** Cómo se cobra ESTA reserva: la mayoría por pallets, algunas por kilos. */
  unit: ClosingUnit
  pallets: number | null
  kg: number | null
  /** Pallets o kilos, según la unidad de la reserva. */
  units: number | null
  /** Tramos cobrados: unidades ÷ tamaño del tramo, hacia arriba. */
  tramos: number
  odNumber: string | null
  guideNumber: string | null
  urgent: boolean
  /** Se repaletizó: se cobra aparte, en pesos (Configuración → Precios). */
  repalletize: boolean
  /** Cliente final de la entrega, leído de las notas («CLIENTE: …»). null = no viene. */
  customer: string | null
  /** Fotos y documentos del trabajo (respaldo de la entrega). */
  receptionPhotos: { id: string; fileName: string }[]
  /**
   * Observación escrita por la oficina para el cierre («Autorizado por Philip»). Sale en el PDF
   * y el Excel. Opcional: los cierres guardados antes de add_observaciones_cierre.sql no la traen.
   */
  note?: string | null
  /** Neto en la moneda de la tarifa (UF o pesos): tramos + urgencia. */
  net: number
  /** Neto en pesos. Con tarifa en UF es REFERENCIAL: los pesos se fijan al facturar. */
  netClp: number
  /** Lo que falta en el trabajo: unidades, OD, guía o factura, foto. */
  missing: string[]
}

export interface ClosingTotals {
  jobs: number
  pallets: number
  kg: number
  tramos: number
  urgentCount: number
  repalletizeCount: number
  /** Repaletizado en pesos, aparte del neto en UF (como lo cobra Monfiza). */
  repalletizeClp: number
  /** Neto en la moneda de la tarifa. */
  net: number
  /** Neto en pesos (referencial si la tarifa es en UF). */
  netClp: number
  /** Trabajos a los que les falta algo. */
  incomplete: number
}

export interface SavedCompanyClosing {
  id: string
  from: string
  to: string
  unit: ClosingUnit
  ufValue: number | null
  totalClp: number
  closedBy: string | null
  closedAt: string
  reopenedBy: string | null
  reopenedAt: string | null
}

/** Lo que se guarda en un cierre y lo que se exporta. */
export interface ClosingSnapshot {
  company: { id: string; code: string; razonSocial: string; rut: string }
  from: string
  to: string
  tariff: CompanyTariff
  uf: { value: number; date: string; source: 'mindicador' | 'manual' } | null
  /** Pesos por repaletizado al momento del cierre. 0 = sin definir. */
  repalletizePrice?: number
  rows: ClosingRow[]
  totals: ClosingTotals
}

export interface CompanyClosingData extends ClosingSnapshot {
  /** false = falta correr add_cierre_empresas.sql. */
  available: boolean
  closings: SavedCompanyClosing[]
  /** Cierre vigente que se cruza con el período elegido, si hay. */
  overlapping: SavedCompanyClosing | null
  /**
   * Trabajos hasta hoy que quedan FUERA del período y no están en un cierre vigente ni en una
   * factura: el panel avisa que existen, para que no desaparezcan por tener otras fechas.
   */
  outside: { count: number; withFiles: number; from: string; to: string } | null
}

const round2 = (n: number) => Math.round(n * 100) / 100
const round4 = (n: number) => Math.round(n * 10_000) / 10_000

/** Tramos de una cantidad: hacia arriba (3 pallets en tramos de 2 = 2 tramos). Sin cantidad, 0. */
export function tramosFor(units: number | null, tramoSize: number | null): number {
  if (!units || units <= 0 || !tramoSize || tramoSize <= 0) return 0
  return Math.ceil(units / tramoSize)
}

/**
 * Valoriza los trabajos: tramos × precio por tramo, más el recargo en los urgentes. Cada
 * trabajo se cobra por su unidad (pallets o kilos). `uf` = valor de la UF para mostrar los
 * pesos de una tarifa en UF (referencial: el monto en pesos se fija al facturar).
 */
export function valueClosing(
  rows: Omit<ClosingRow, 'units' | 'tramos' | 'net' | 'netClp' | 'missing'>[],
  tariff: CompanyTariff,
  uf: number | null,
  /** Pesos por repaletizado (Configuración → Precios). 0 = sin definir. */
  repalletizePrice = 0
): { rows: ClosingRow[]; totals: ClosingTotals } {
  const valued = rows.map((r): ClosingRow => {
    const units = r.unit === 'pallets' ? r.pallets : r.kg
    const tramos = tramosFor(units, r.unit === 'pallets' ? tariff.tramoPallets : tariff.tramoKg)
    const net = round4(tramos * (tariff.tramoPrice || 0) + (r.urgent ? tariff.urgencyPrice || 0 : 0))
    const netClp = tariff.currency === 'CLP' ? Math.round(net) : uf ? Math.round(net * uf) : 0
    const missing: string[] = []
    if (!units) missing.push(r.unit === 'pallets' ? 'pallets' : 'kilos')
    // Sin tamaño de tramo para esa unidad el trabajo valdría 0 sin que nadie lo note.
    const size = r.unit === 'pallets' ? tariff.tramoPallets : tariff.tramoKg
    if (units && !(size && size > 0)) missing.push(r.unit === 'pallets' ? 'tarifa sin tramo de pallets' : 'tarifa sin tramo de kilos')
    if (!r.odNumber) missing.push('N° OD')
    if (!r.guideNumber) missing.push('N° guía o factura')
    if (r.receptionPhotos.length === 0) missing.push('foto de recepción')
    return { ...r, units, tramos, net, netClp, missing }
  })
  return {
    rows: valued,
    totals: {
      jobs: valued.length,
      pallets: valued.filter((r) => r.unit === 'pallets').reduce((sum, r) => sum + (r.pallets || 0), 0),
      kg: round2(valued.filter((r) => r.unit === 'kg').reduce((sum, r) => sum + (r.kg || 0), 0)),
      tramos: valued.reduce((sum, r) => sum + r.tramos, 0),
      urgentCount: valued.filter((r) => r.urgent).length,
      repalletizeCount: valued.filter((r) => r.repalletize).length,
      repalletizeClp: valued.filter((r) => r.repalletize).length * (repalletizePrice > 0 ? Math.round(repalletizePrice) : 0),
      net: round4(valued.reduce((sum, r) => sum + r.net, 0)),
      netClp: valued.reduce((sum, r) => sum + r.netClp, 0),
      incomplete: valued.filter((r) => r.missing.length > 0).length,
    },
  }
}

/** «1,28 UF» o «$12.000», con «por tramo» u otro sufijo. */
export function tariffLabel(price: number | null, currency: TariffCurrency, per?: string): string {
  if (price === null) return 'sin definir'
  const value = currency === 'UF' ? `${price.toLocaleString('es-CL', { maximumFractionDigits: 4 })} UF` : `$${Math.round(price).toLocaleString('es-CL')}`
  return per ? `${value} ${per}` : value
}

/** «1,28 UF + IVA por cada 2 pallets o 1.000 kg; urgencia 0,29 UF + IVA». */
export function tariffSummary(t: CompanyTariff): string {
  if (!t.closingUnit) return 'no se cierra por unidad'
  const size = [t.tramoPallets ? `${t.tramoPallets.toLocaleString('es-CL')} pallets` : null, t.tramoKg ? `${t.tramoKg.toLocaleString('es-CL')} kg` : null].filter(Boolean).join(' o ')
  return `${tariffLabel(t.tramoPrice, t.currency)} + IVA por cada ${size || 'tramo sin definir'}; urgencia ${tariffLabel(t.urgencyPrice, t.currency)} + IVA`
}

/** Lo que ve y completa el trabajador en un trabajo de una empresa que se cierra por unidad. */
export interface WorkerDelivery {
  company: string
  /** Unidad de esta reserva (la de la empresa si no se eligió otra). */
  unit: 'pallets' | 'kg'
  pallets: number | null
  kg: number | null
  odNumber: string
  guideNumber: string
  /** Fotos de recepción ya subidas. */
  photos: number
  /**
   * Trabajo del servicio «Pallets» (add_servicio_pallets.sql): el N° de guía de despacho o de
   * factura es obligatorio para finalizar. Si la empresa no se cierra por unidad (no es como
   * Monfiza), el formulario pide solo pallets y guía.
   */
  palletService?: boolean
  /** La empresa se cierra por pallets o kilos (pide OD, kilos y foto de recepción). */
  closesByUnit?: boolean
}

/**
 * El cliente final de una entrega de Monfiza viene en las notas de la reserva («CLIENTE:
 * EMBOTELLADORA ANDINA OC 4100200139 FACTURA/GUIA PDTE…»): se toma hasta «OC», «FACTURA»,
 * «GUIA», «Producto» o un punto.
 */
export function customerFromNotes(notes: string | null | undefined): string | null {
  const m = String(notes || '').replace(/\s+/g, ' ').match(/CLIENTE\s*:\s*(.+?)(?=\.?\s+(?:OC|FACTURA|GU[IÍ]A|PRODUCTO|LOTE)\b|\.(?=\s|$)|$)/i)
  const name = m?.[1]?.trim()
  return name ? name.slice(0, 80) : null
}

/** N° de OD escrito en las notas («OD 43122»), para cuando no se anotó aparte. */
export function odFromNotes(notes: string | null | undefined): string | null {
  const m = String(notes || '').match(/\bOD\s*:?\s*(?:N[°º.]?\s*|#\s*)?(\d{1,3}(?:\.\d{3})+|\d{4,})/i)
  return m ? m[1].replace(/\./g, '') : null
}
