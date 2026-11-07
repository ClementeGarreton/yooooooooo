import { countsForRevenue, paidAmount, pendingAmount, servicePrice } from './revenueBreakdown'
import {
  buildCustomerIdentityIndex,
  normalizeCustomerEmail,
  normalizeOrigin,
  type CustomerIdentityRow,
} from './prospectSource'

export interface MonthlyPoint {
  month: string // 'YYYY-MM'
  label: string // mes corto en español
  count: number
  /** Valor de los servicios reservados ese mes (cobrado + por cobrar). */
  revenue: number
  /** Plata efectivamente recibida. */
  paid: number
  /** Comprometido y todavía no cobrado. */
  pending: number
}

export interface SourceCount {
  source: string
  label: string
  count: number
}

export interface FunnelStage {
  key: string
  label: string
  count: number
}

export interface AttendedCustomer {
  email: string
  name: string
  phone: string
  isCompany: boolean
  companyName: string
  companyRut: string
  movesCount: number
  lastMoveDate: string | null // 'YYYY-MM-DD'
  firstMoveDate: string | null
  totalSpent: number
  origin: string
}

export interface UnifiedCustomer extends AttendedCustomer {
  isFrequent?: boolean
  notes?: string
}

export interface BookingLike {
  scheduled_date?: string | null
  status?: string | null
  total_price?: number | null
  original_price?: number | null
  adjusted_price?: number | null
  amount_paid?: number | null
  client_email?: string | null
  client_name?: string | null
  client_phone?: string | null
  is_company?: boolean | null
  company_name?: string | null
  company_rut?: string | null
  payment_status?: string | null
  payment_type?: string | null
  source?: string | null
}

// Un booking cuenta como "cliente atendido" si el servicio se marcó completado,
// o si ya pagó el 100% (aunque el admin no haya movido el estado a 'completed').
export function isAttendedBooking(b: BookingLike): boolean {
  if (b.status === 'cancelled') return false
  if (b.status === 'completed') return true
  return b.payment_status === 'approved' && b.payment_type === 'completo'
}

export interface ProspectLike {
  source?: string | null
  status?: string | null
}

export interface CustomerProspectLike extends CustomerIdentityRow {
  name?: string | null
  phone?: string | null
  is_company?: boolean | null
  company_name?: string | null
  company_rut?: string | null
  notes?: string | null
}

const MESES_CORTOS = [
  'ene',
  'feb',
  'mar',
  'abr',
  'may',
  'jun',
  'jul',
  'ago',
  'sep',
  'oct',
  'nov',
  'dic',
]

export function groupBookingsByMonth(bookings: BookingLike[], monthsBack: number): MonthlyPoint[] {
  const now = new Date()
  const currentYear = now.getFullYear()
  const currentMonthIndex = now.getMonth()

  // Generar los últimos mesesBack meses
  const months: { monthKey: string; label: string }[] = []
  for (let i = monthsBack - 1; i >= 0; i--) {
    const monthIndex = (currentMonthIndex - i + 12) % 12
    const year = currentYear - (currentMonthIndex < i ? 1 : 0)
    const monthKey = `${year}-${String(monthIndex + 1).padStart(2, '0')}`
    const label = MESES_CORTOS[monthIndex]

    months.push({ monthKey, label })
  }

  // Agrupar los bookings por mes
  const monthlyMap = new Map<
    string,
    { count: number; revenue: number; paid: number; pending: number }
  >()

  for (const month of months) {
    monthlyMap.set(month.monthKey, { count: 0, revenue: 0, paid: 0, pending: 0 })
  }

  for (const booking of bookings) {
    if (!booking.scheduled_date) continue

    // MISMO criterio que las tarjetas de Ingresos (`countsForRevenue`): excluye
    // canceladas, no atendidas Y pre-reservas sin pagar.
    //
    // Antes acá solo se excluían las canceladas, así que el gráfico contaba las
    // pre-reservas y las tarjetas no: en septiembre-2026 eso daba $4.784.551 en el
    // gráfico contra $3.345.214 en las tarjetas — 6 pre-reservas, $1.439.337 de
    // diferencia. Dos definiciones distintas de "ingresos" sin decirlo.
    if (!countsForRevenue(booking)) continue

    const monthKey = booking.scheduled_date.slice(0, 7)

    if (monthlyMap.has(monthKey)) {
      const bookingMonth = monthlyMap.get(monthKey)!
      bookingMonth.count += 1
      bookingMonth.revenue += servicePrice(booking)
      bookingMonth.paid += paidAmount(booking)
      bookingMonth.pending += pendingAmount(booking)
      monthlyMap.set(monthKey, bookingMonth)
    }
  }

  return months.map(({ monthKey, label }) => {
    const { count, revenue, paid, pending } = monthlyMap.get(monthKey)!

    return {
      month: monthKey,
      label,
      count,
      revenue,
      paid,
      pending,
    }
  })
}

export function groupProspectsBySource(prospects: ProspectLike[]): SourceCount[] {
  const sourceMap = new Map<string, number>()

  for (const prospect of prospects) {
    const sourceKey = prospect.source || 'sin_origen'

    if (!sourceMap.has(sourceKey)) {
      sourceMap.set(sourceKey, 0)
    }

    const count = sourceMap.get(sourceKey)!
    sourceMap.set(sourceKey, count + 1)
  }

  const labels: Record<string, string> = {
    web: 'Web',
    pdf_download: 'Descarga PDF',
    email_quote: 'Email',
    checkout_initiated: 'Checkout',
    domicilio: 'Domicilio',
    rrss: 'RRSS',
    recomendacion: 'Recomendación',
    cliente_antiguo: 'Cliente antiguo',
    sin_origen: 'Sin origen',
  }

  const result = Array.from(sourceMap.entries()).map(([source, count]) => {
    return {
      source,
      label: labels[source] || source,
      count,
    }
  })

  // Ordenar por cantidad descendente (DESC)
  result.sort((a, b) => {
    return b.count - a.count
  })

  return result
}

export function groupCustomersBySource(
  customers: Array<Pick<AttendedCustomer, 'origin'>>
): SourceCount[] {
  const counts = new Map<string, number>()

  customers.forEach((customer) => {
    const origin = normalizeOrigin(customer.origin)
    counts.set(origin, (counts.get(origin) || 0) + 1)
  })

  const labels: Record<string, string> = {
    web: 'Web / nuevos',
    rrss: 'RRSS',
    recomendacion: 'Recomendación',
    cliente_antiguo: 'Cliente antiguo',
  }

  return [...counts.entries()]
    .map(([source, count]) => ({ source, label: labels[source] || source, count }))
    .sort((a, b) => b.count - a.count)
}

export function buildFunnel(prospects: ProspectLike[], bookings: BookingLike[]): FunnelStage[] {
  const completedBookings = bookings.filter((b) => b.status !== 'cancelled')

  const reservationsCount = completedBookings.length

  const completedCount = bookings.filter((b) => b.status === 'completed').length

  return [
    { key: 'leads', label: 'Leads', count: prospects.length },
    { key: 'reservas', label: 'Reservas', count: reservationsCount },
    { key: 'completadas', label: 'Completadas', count: completedCount },
  ]
}

export function aggregateAttendedCustomers(bookings: BookingLike[]): AttendedCustomer[] {
  const customersMap = new Map<
    string,
    {
      email: string
      name: string
      phone: string
      isCompany: boolean
      companyName: string
      companyRut: string
      movesCount: number
      lastMoveDate: string | null
      firstMoveDate: string | null
      totalSpent: number
      origin: string
    }
  >()

  for (const booking of bookings) {
    if (!isAttendedBooking(booking)) continue

    const email = (booking.client_email || '').trim().toLowerCase()

    if (!email) continue

    const existing = customersMap.get(email)

    // Si no existe, inicializar
    if (!existing) {
      customersMap.set(email, {
        email,
        name: booking.client_name || '',
        phone: booking.client_phone || '',
        isCompany: Boolean(booking.is_company),
        companyName: booking.company_name || '',
        companyRut: booking.company_rut || '',
        movesCount: 1,
        lastMoveDate: booking.scheduled_date ?? null,
        firstMoveDate: booking.scheduled_date ?? null,
        totalSpent: servicePrice(booking),
        origin: booking.source || 'web',
      })
    } else {
      // Actualizar existente

      const price = servicePrice(booking)
      const d = booking.scheduled_date ?? null
      existing.movesCount += 1
      existing.totalSpent += price
      if (booking.source === 'cliente_antiguo') existing.origin = 'cliente_antiguo'

      // Datos de identidad: los del booking más reciente (>= para que el primero gane empates)
      if (d && (!existing.lastMoveDate || d >= existing.lastMoveDate)) {
        existing.name = booking.client_name || ''
        existing.phone = booking.client_phone || ''
        existing.isCompany = Boolean(booking.is_company)
        existing.companyName = booking.company_name || ''
        existing.companyRut = booking.company_rut || ''
      }

      // Actualizar fechas min/max (comparación de strings 'YYYY-MM-DD')
      if (d && (!existing.lastMoveDate || d > existing.lastMoveDate)) {
        existing.lastMoveDate = d
      }
      if (d && (!existing.firstMoveDate || d < existing.firstMoveDate)) {
        existing.firstMoveDate = d
      }
    }
  }

  const result = Array.from(customersMap.values())

  // Ordenar por movesCount DESC, y luego totalSpent DESC
  result.sort((a, b) => {
    if (b.movesCount !== a.movesCount) return b.movesCount - a.movesCount
    return b.totalSpent - a.totalSpent
  })

  return result
}

// Cartera única por email: clientes atendidos derivados de reservas + fichas creadas
// manualmente. Las oportunidades repetidas siguen existiendo, pero no crean personas
// repetidas en Clientes ni en el gráfico de origen.
export function buildUnifiedCustomers(
  bookings: BookingLike[],
  prospects: CustomerProspectLike[]
): UnifiedCustomer[] {
  const attended = aggregateAttendedCustomers(bookings) as UnifiedCustomer[]
  const byEmail = new Map(attended.map((customer) => [customer.email, customer]))
  const identities = buildCustomerIdentityIndex(prospects)

  for (const prospect of prospects) {
    const email = normalizeCustomerEmail(prospect.email)
    if (!email) continue

    const identity = identities.get(email)
    const existing = byEmail.get(email)

    if (existing) {
      if (identity) existing.origin = identity.origin
      existing.isFrequent = Boolean(existing.isFrequent) || Boolean(identity?.isFrequent)
      existing.notes = existing.notes || prospect.notes || ''
      continue
    }

    if (!identity?.isCustomer) continue

    byEmail.set(email, {
      email,
      name: prospect.name || email,
      phone: prospect.phone || '',
      isCompany: Boolean(prospect.is_company),
      companyName: prospect.company_name || '',
      companyRut: prospect.company_rut || '',
      movesCount: 0,
      firstMoveDate: null,
      lastMoveDate: null,
      totalSpent: 0,
      origin: identity.origin,
      isFrequent: identity.isFrequent,
      notes: prospect.notes || '',
    })
  }

  return [...byEmail.values()].sort((a, b) => {
    if (b.movesCount !== a.movesCount) return b.movesCount - a.movesCount
    return b.totalSpent - a.totalSpent
  })
}
