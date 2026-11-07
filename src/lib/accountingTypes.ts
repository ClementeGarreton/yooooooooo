// Tipos de la contabilidad del panel de Finanzas, SIN dependencias de servidor.

export interface IvaLine {
  count: number
  net: number
  iva: number
}

/** IVA de un mes según el Registro de Compras y Ventas del SII (leído vía Emisso). */
export interface IvaMonth {
  period: string
  /** false = faltan la key de Emisso o la conexión del SII en el servidor. */
  configured: boolean
  /** Si Emisso respondió un error, su mensaje. */
  error: string | null
  /** Cuándo sincronizó Emisso ese mes con el SII, y si lo leyó completo. */
  syncedAt: string | null
  complete: boolean
  sales: {
    invoices: IvaLine
    debitNotes: IvaLine
    creditNotes: IvaLine
    /** Boletas: el SII las informa como un total del mes. */
    receipts: IvaLine
    /** Comprobantes de pago con tarjeta (48): informativo, NO se suma (pueden repetir ventas con boleta). */
    cardVouchers: IvaLine
  }
  purchases: {
    invoices: IvaLine
    debitNotes: IvaLine
    creditNotes: IvaLine
    exempt: IvaLine
    /** Compras que el SII todavía tiene «pendientes» (sin acuse): no dan crédito aún. */
    pending: IvaLine
  }
  /** IVA de las ventas (débito) y de las compras registradas (crédito). */
  debit: number
  credit: number
  /** débito − crédito. Positivo = a pagar; negativo = remanente a favor. */
  result: number
}

export interface BankMovement {
  date: string
  description: string
  amount: number
  /** 'abono' entra plata, 'cargo' sale. */
  kind: 'abono' | 'cargo'
  account: string | null
  provisional: boolean
}

export interface BankMonth {
  period: string
  configured: boolean
  error: string | null
  movements: BankMovement[]
  credits: number
  debits: number
  balances: { account: string; balance: number; date: string | null }[]
  /** true = hay más movimientos de los que se trajeron. */
  truncated: boolean
}

/** Cobros de Flow de un mes, cruzados con el libro de cobros del panel. */
export interface FlowMonth {
  period: string
  configured: boolean
  error: string | null
  /** Pagos que Flow reporta como pagados en el mes. */
  count: number
  total: number
  /** Comisión que cobró Flow (si la informa) y lo que quedó para depositar. */
  fees: number
  net: number
  /** Cobros del panel marcados como de Flow en el mes. */
  ledgerCount: number
  ledgerTotal: number
  /** Pagados en Flow que el panel no tiene registrados. */
  missingInPanel: { flowOrder: number; commerceOrder: string; amount: number; date: string }[]
  /** Registrados en el panel como Flow que Flow no reporta pagados en el mes. */
  missingInFlow: { flowOrder: number | null; quoteId: string; amount: number; date: string }[]
}


/** Un movimiento del panel (cobro, gasto o pago a un trabajador) que se busca en el banco. */
export interface PanelEntry {
  id: string
  date: string
  amount: number
  /** Qué es, para leerlo en la lista: «Cobro RES-000123 · Juan Pérez», «Gasto: bencina». */
  label: string
  /** De dónde sale. Un cobro en efectivo no va a aparecer nunca en el banco. */
  source: 'cobro' | 'gasto' | 'pago_trabajador'
  detail: string | null
}

export interface ReconciliationSide {
  /** Movimientos del banco de este lado (abonos o cargos). */
  bankCount: number
  bankTotal: number
  /** Lo del panel que se buscó en el banco. */
  panelCount: number
  panelTotal: number
  matched: { bank: BankMovement; panel: PanelEntry }[]
  matchedTotal: number
  /** Está en el banco y no en el panel: plata que entró o salió sin registrar. */
  onlyBank: BankMovement[]
  onlyBankTotal: number
  /** Está en el panel y no en el banco: efectivo, otro mes, otra cuenta o un error. */
  onlyPanel: PanelEntry[]
  onlyPanelTotal: number
}

/** Cruce de un mes entre la cartola del banco y lo registrado en el panel. */
export interface BankReconciliation {
  period: string
  bankConfigured: boolean
  bankError: string | null
  /** false = el banco no entregó ningún movimiento del mes: no hay con qué cruzar. */
  bankHasData: boolean
  /** Abonos del banco contra cobros del panel que no pasaron por Flow. */
  income: ReconciliationSide
  /** Cargos del banco contra gastos de la empresa y pagos a trabajadores. */
  expenses: ReconciliationSide
  /** Cobros por Flow del mes en el panel: Flow los deposita agrupados, no se cruzan uno a uno. */
  flowLedgerTotal: number
}
