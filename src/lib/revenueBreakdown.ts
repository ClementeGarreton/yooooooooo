// Desglose de ingresos para el dashboard: cobrado / por cobrar / cotizado vigente.
//
// CONTEXTO IMPORTANTE SOBRE LOS DATOS (verificado sobre las 80 reservas reales, jul-2026):
//
// `total_price` CAMBIÓ de significado a mitad de camino. Hasta junio-2026 guardaba el
// MONTO PAGADO (50% o 95% del precio); desde julio-2026 —tras el fix de "total_price
// pisado"— guarda el PRECIO DEL SERVICIO, igual que `original_price`. En julio conviven
// 35 registros con la semántica nueva y 2 con la vieja.
//
// Por eso NO se suma `total_price` para saber lo cobrado: mezclaría dos significados.
// Desde ago-2026 `amount_paid` guarda el cobro real. Para los registros históricos que
// todavía no lo tienen, se conserva como respaldo la regla de negocio verificada:
//   - payment_type 'mitad'    -> paga el 50% ahora, el resto al terminar el traslado
//   - payment_type 'completo' -> paga el 95% (5% de descuento por pagar todo por adelantado)
//
// El 5% de descuento NO es deuda: quien pagó completo no debe nada. Los "ingresos
// pagados" reflejan plata realmente recibida (decisión de Francisco, jul-2026).
//
// VALIDACIÓN DE LA FÓRMULA (ago-2026): se contrastó contra los 21 cobros históricos en
// los que `total_price` guardaba el monto que Flow cobró de verdad (medios reportados:
// Webpay, Onepay, transferencia). La fórmula reproduce 20 de 21 al peso exacto; el
// restante difiere en $143 por redondeo ($72.978 calculado vs $73.121 cobrado). Sobre
// un total de $1.854.095 el desvío agregado es del 0,008%.
//
// No se pudo consultar la API de Flow en vivo para revalidar: el `.env.local` apunta al
// sandbox (sandbox.flow.cl) y los tokens guardados son de producción, así que devuelven
// 403. Para un contraste directo hay que comparar el panel de Flow con el dashboard.

export interface BookingLike {
  original_price?: number | null
  total_price?: number | null
  adjusted_price?: number | null
  amount_paid?: number | null
  payment_type?: string | null
  payment_status?: string | null
  status?: string | null
  is_provisional?: boolean | null
  flow_token?: string | null
  payment_method?: string | null
  /** Origen comercial heredado de la ficha/prospecto vinculado. */
  source?: string | null
}

export interface ProspectLike {
  status?: string | null
  total_price?: number | null
  adjusted_price?: number | null
  scheduled_date?: string | null
  converted_booking_id?: string | null
}

export const HALF_RATIO = 0.5
/** Pago adelantado completo: 5% de descuento. */
export const FULL_RATIO = 0.95

/**
 * Piso del abono con el que una reserva se toma como confirmada y se sale a trabajar.
 *
 * El 50% dejó de ser obligatorio para empezar (decisión de Tomás, 2026-09-08): alcanza
 * con este monto. Solo aplica a los cobros que arma un admin desde el panel; el
 * cotizador público sigue ofreciendo 50% o pago completo.
 *
 * Lo que NO cambia: el saldo se sigue debiendo. `pendingAmount()` lo calcula contra
 * `amount_paid` real, así que un abono parcial deja la reserva confirmada y con la
 * diferencia a cobrar.
 */
export const MIN_ABONO_CLP = 30000

/**
 * Abono para reservar desde el cotizador, «Mi cuenta» y los links de pago: la mitad, pero no
 * menos que MIN_ABONO_CLP aunque en un servicio chico eso pase del 50% (Tomás, 19-10-2026,
 * para que un cupón funcione desde $50.000). Nunca más que el total.
 */
export function depositAmount(price: number): number {
  const total = Math.round(price)
  if (total <= 0) return 0
  return Math.min(total, Math.max(Math.round(total * 0.5), MIN_ABONO_CLP))
}

/**
 * Precio vigente del servicio. Un reajuste en terreno manda sobre el valor cotizado;
 * `total_price` queda como respaldo para registros históricos incompletos.
 */
export function servicePrice(b: BookingLike): number {
  const adjusted = Number(b.adjusted_price) || 0
  if (adjusted > 0) return adjusted
  const original = Number(b.original_price) || 0
  if (original > 0) return original
  return Number(b.total_price) || 0
}

/**
 * Proporción del precio que el cliente paga según su modalidad.
 * Sin `payment_type` (4 reservas históricas) se asume el total: si figura como pagada,
 * lo más probable es que se haya cobrado completo de forma manual.
 */
export function paidRatio(paymentType?: string | null): number {
  if (paymentType === 'mitad') return HALF_RATIO
  if (paymentType === 'completo') return FULL_RATIO
  return 1
}

/** ¿La reserva ocupa cupo y cuenta para los números? (excluye canceladas y pre-reservas) */
export function countsForRevenue(b: BookingLike): boolean {
  if (b.is_provisional) return false
  return !['cancelled', 'no_show'].includes(String(b.status || ''))
}

export function isPaid(b: BookingLike): boolean {
  return b.payment_status === 'approved'
}

/**
 * Monto efectivamente recibido, incluso si la reserva luego fue cancelada o marcada
 * como no atendida. Sirve para la ficha operativa, donde el pago real no debe ocultarse.
 */
export function actualPaidAmount(b: BookingLike): number {
  if (b.amount_paid !== undefined && b.amount_paid !== null) {
    const recorded = Number(b.amount_paid)
    if (Number.isFinite(recorded)) return Math.max(0, Math.round(recorded))
  }
  if (!isPaid(b)) return 0
  return Math.round(servicePrice(b) * paidRatio(b.payment_type))
}

/** Monto que entra al resumen de ingresos (excluye pre-reservas y cierres sin servicio). */
export function paidAmount(b: BookingLike): number {
  if (!countsForRevenue(b)) return 0
  return actualPaidAmount(b)
}

/**
 * Monto que todavía falta cobrar: lo que se esperaba cobrar menos lo que entró.
 * - Sin pago aprobado: se debe el precio completo del servicio.
 * - Pagó la mitad: se debe la otra mitad (se cobra al terminar el traslado).
 * - Pagó completo por adelantado: se esperaba el 95%, porque el 5% es descuento y no deuda.
 *
 * Antes, un `payment_type = 'completo'` aprobado devolvía 0 sin mirar el monto. Con eso,
 * registrar un pago parcial y marcarlo «completo» —lo único que se podía hacer al
 * convertir un prospecto— borraba el saldo: la reserva desaparecía de «Por cobrar», del
 * link de saldo y del correo. Medido sobre las reservas de producción el 23-sep-2026,
 * este cambio no altera el saldo de ninguna: solo evita el agujero de ahora en adelante.
 */
export function pendingAmount(b: BookingLike): number {
  if (!countsForRevenue(b)) return 0
  const price = servicePrice(b)
  const expected =
    isPaid(b) && b.payment_type === 'completo' ? Math.round(price * FULL_RATIO) : price
  return Math.max(0, expected - actualPaidAmount(b))
}

/** Canal por el que entró la plata. Flow deja `flow_token`; lo manual no. */
export function paymentChannel(b: BookingLike): 'flow' | 'transfer' | 'cash' | 'otro' {
  if (b.flow_token) return 'flow'
  const method = String(b.payment_method || '').toLowerCase()
  if (method.includes('transfer')) return 'transfer'
  if (method === 'cash' || method.includes('efectivo')) return 'cash'
  // Los valores que reporta Flow (Webpay, Onepay, Mach/BCI, Khipu…) son pagos online.
  if (method) return 'flow'
  return 'otro'
}

export interface RevenueBreakdown {
  /** Plata efectivamente recibida. */
  paid: number
  paidByChannel: { flow: number; transfer: number; cash: number; otro: number }
  paidCount: number
  /** Comprometido en reservas pero aún no cobrado. */
  pending: number
  pendingCount: number
  /** Valor total de los servicios reservados (cobrado + por cobrar). */
  booked: number
}

export interface RevenueByOrigin extends RevenueBreakdown {
  source: string
  label: string
}

const REVENUE_ORIGINS = [
  { source: 'web', label: 'Web / cliente nuevo' },
  { source: 'cliente_antiguo', label: 'Cliente antiguo' },
  { source: 'rrss', label: 'RRSS' },
  { source: 'recomendacion', label: 'Recomendación' },
] as const

const revenueOrigin = (source?: string | null) =>
  source === 'cliente_antiguo' || source === 'rrss' || source === 'recomendacion'
    ? source
    : 'web'

export function summarizeBookings(bookings: BookingLike[]): RevenueBreakdown {
  const out: RevenueBreakdown = {
    paid: 0,
    paidByChannel: { flow: 0, transfer: 0, cash: 0, otro: 0 },
    paidCount: 0,
    pending: 0,
    pendingCount: 0,
    booked: 0,
  }

  for (const b of bookings) {
    if (!countsForRevenue(b)) continue

    out.booked += servicePrice(b)

    const paid = paidAmount(b)
    if (paid > 0) {
      out.paid += paid
      out.paidCount += 1
      out.paidByChannel[paymentChannel(b)] += paid
    }

    const pending = pendingAmount(b)
    if (pending > 0) {
      out.pending += pending
      out.pendingCount += 1
    }
  }

  return out
}

/** Mismo cálculo financiero, separado por origen comercial del cliente. */
export function summarizeBookingsByOrigin(bookings: BookingLike[]): RevenueByOrigin[] {
  return REVENUE_ORIGINS.map(({ source, label }) => ({
    source,
    label,
    ...summarizeBookings(
      bookings.filter((booking) => revenueOrigin(booking.source) === source)
    ),
  }))
}

export interface QuotesOutstanding {
  /** Suma de cotizaciones que todavía se pueden cerrar. */
  total: number
  count: number
}

/**
 * Cotizaciones sin reserva que siguen vigentes: la mudanza aún no ocurrió y el lead no
 * está cerrado (ni convertido ni perdido). Criterio definido por Francisco (jul-2026).
 *
 * `today` se pasa como 'YYYY-MM-DD' en hora de Chile para no depender del huso del server.
 */
export function summarizeOutstandingQuotes(
  prospects: ProspectLike[],
  today: string
): QuotesOutstanding {
  let total = 0
  let count = 0

  for (const p of prospects) {
    if (!isOutstandingQuote(p, today)) continue
    total += quoteValue(p)
    count += 1
  }

  return { total: Math.round(total), count }
}

/** Valor de una cotización: el ajustado si lo hay, si no el cotizado. */
export function quoteValue(p: ProspectLike): number {
  return Number(p.adjusted_price) || Number(p.total_price) || 0
}

/**
 * ¿Sigue vigente esta cotización? Mismo criterio que summarizeOutstandingQuotes, aparte
 * para que el Panel del Cliente marque «vigente / vencida» con la misma regla que suma
 * el dashboard, y no con una parecida.
 */
export function isOutstandingQuote(p: ProspectLike, today: string): boolean {
  if (p.converted_booking_id) return false
  if (['converted', 'lost'].includes(String(p.status || ''))) return false
  if (!p.scheduled_date || p.scheduled_date < today) return false
  return quoteValue(p) > 0
}
