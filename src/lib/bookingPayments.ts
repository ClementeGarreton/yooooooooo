import { supabaseAdmin } from '@/lib/supabase'

// Libro de pagos: una fila por COBRO (ver database/migrations/add_booking_payments.sql).
//
// Existe por una razón concreta: el link del saldo hace que una misma reserva reciba dos
// cobros, y `bookings.amount_paid` es un solo número. Para poder SUMAR el segundo pago
// hace falta saber si ese pago ya se aplicó — Flow reintenta el webhook, y además
// `/api/payment/result` aplica el mismo pago cuando el cliente vuelve por el navegador.
//
// `flow_token` es único en la tabla: ESA es la clave de idempotencia. Mismo patrón que
// `email_log` para no mandar el mismo correo dos veces.

/** Tipo de cobro, para poder leer el historial de una reserva de un vistazo. */
export type PaymentKind = 'abono' | 'completo' | 'saldo' | 'manual' | 'historico'

export interface RecordPaymentInput {
  bookingId: string | null
  quoteId: string
  flowToken: string | null
  flowOrder?: number | null
  amount: number
  kind: PaymentKind
  status?: string
  paidAt?: string | null
}

export interface RecordPaymentResult {
  /**
   * true = este cobro se registró AHORA y todavía no estaba sumado.
   * false = ya estaba (reintento del webhook, retorno del navegador) o no se pudo escribir.
   * Solo se debe tocar `amount_paid` cuando esto es true.
   */
  recorded: boolean
  /** false si la tabla no existe todavía (falta correr la migración). */
  ledgerAvailable: boolean
}

/** 42P01 = undefined_table: la migración del libro de pagos no está aplicada. */
function isMissingTable(error: { code?: string } | null): boolean {
  return error?.code === '42P01'
}

/** 23505 = unique_violation: ese flow_token ya está en el libro. */
function isUniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === '23505'
}

/** ¿Está aplicada la migración del libro de pagos? */
export async function isPaymentLedgerAvailable(): Promise<boolean> {
  const { error } = await supabaseAdmin.from('booking_payments').select('id').limit(1)
  if (!error) return true
  if (isMissingTable(error)) return false
  // Otro error (permisos, red): no se puede afirmar que falte la tabla.
  console.error('[bookingPayments] No se pudo comprobar el libro de pagos:', error.message)
  return false
}

/**
 * Registra un cobro. Devuelve `recorded: false` si ese `flow_token` ya estaba anotado:
 * en ese caso el llamador NO debe volver a sumar el monto.
 *
 * Un cobro sin token (transferencia, efectivo) no tiene forma de deduplicarse solo, así
 * que siempre se inserta: la idempotencia de esos la da el panel, que los carga a mano.
 */
export async function recordPayment(input: RecordPaymentInput): Promise<RecordPaymentResult> {
  const row = {
    booking_id: input.bookingId,
    quote_id: input.quoteId,
    flow_token: input.flowToken,
    flow_order: input.flowOrder ?? null,
    amount: Math.max(0, Math.round(input.amount)),
    kind: input.kind,
    status: input.status || 'approved',
    paid_at: input.paidAt || new Date().toISOString(),
  }

  // INSERT simple, no upsert. El índice único de `flow_token` es PARCIAL (WHERE flow_token
  // IS NOT NULL) y Postgres no lo acepta como destino de `ON CONFLICT (flow_token)` si no
  // se repite ese WHERE, cosa que PostgREST no permite. El upsert que había acá fallaba
  // SIEMPRE con 42P10 (medido el 5-oct-2026: 0 cobros en vivo en el libro desde que se
  // creó), y como el llamador solo suma cuando `recorded` es true, ningún pago de saldo
  // por Flow llegaba a `amount_paid`. La idempotencia la sigue dando el índice único: un
  // token repetido choca con 23505 y se informa como «ya estaba».
  const { data, error } = await supabaseAdmin
    .from('booking_payments')
    .insert(row)
    .select('id')

  if (error) {
    if (isUniqueViolation(error)) {
      // Mismo flow_token: reintento del webhook o retorno del navegador. No es un cobro nuevo.
      return { recorded: false, ledgerAvailable: true }
    }
    if (isMissingTable(error)) {
      console.warn(
        '[bookingPayments] Falta la tabla booking_payments (¿sin correr add_booking_payments.sql?). ' +
          'El cobro NO se registra y el monto NO se suma, para no arriesgar contarlo dos veces.'
      )
      return { recorded: false, ledgerAvailable: false }
    }
    console.error('[bookingPayments] Error registrando el cobro:', error.message)
    return { recorded: false, ledgerAvailable: true }
  }

  return { recorded: Array.isArray(data) && data.length > 0, ledgerAvailable: true }
}

export interface LedgerEntry {
  id: string
  amount: number
  kind: string
  status: string
  paid_at: string | null
  flow_token: string | null
}

/** Historial de cobros de una reserva, del más viejo al más nuevo. */
export async function getPaymentsForBooking(quoteId: string): Promise<LedgerEntry[]> {
  const { data, error } = await supabaseAdmin
    .from('booking_payments')
    .select('id, amount, kind, status, paid_at, flow_token')
    .eq('quote_id', quoteId)
    .order('paid_at', { ascending: true })

  if (error) {
    if (!isMissingTable(error)) {
      console.error('[bookingPayments] Error leyendo el historial:', error.message)
    }
    return []
  }
  return (data || []) as LedgerEntry[]
}
