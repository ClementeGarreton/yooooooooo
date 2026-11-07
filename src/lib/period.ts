// Período de un filtro de fecha del panel. Un solo lugar para las reglas, para que «Semana»
// o «Mes» signifiquen lo mismo en Inicio, Reservas, Trabajos, Prospectos y Actividad (antes
// cada panel tenía su propio selector con sus propias reglas).
//
// Sin dependencias de servidor ni de React.

export type PeriodPreset = 'all' | 'day' | 'tomorrow' | 'week' | 'month' | 'custom'

export interface Period {
  preset: PeriodPreset
  /** Solo para 'custom': 'YYYY-MM-DD'. */
  from: string
  to: string
}

/** Rango ya resuelto. `null` en una punta = sin límite por ese lado. */
export interface PeriodRange {
  from: string | null
  to: string | null
  /** Para escribir «…de {label}»: hoy, mañana, esta semana, este mes, 01-10 al 15-10. */
  label: string
}

export const PERIOD_LABELS: Record<PeriodPreset, string> = {
  all: 'Todo',
  day: 'Hoy',
  tomorrow: 'Mañana',
  week: 'Semana',
  month: 'Mes',
  custom: 'Rango',
}

const chileDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' })

/** Hoy en hora de Chile ('YYYY-MM-DD'): el panel también se abre desde otros husos. */
export function todayChile(): string {
  return chileDay.format(new Date())
}

/** Día de Chile de una marca de tiempo (p. ej. `created_at`). '' si no es una fecha. */
export function chileDayOf(iso: string | null | undefined): string {
  if (!iso) return ''
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : chileDay.format(date)
}

/** Suma días a un 'YYYY-MM-DD' sin pasar por UTC. */
export function addDays(day: string, days: number): string {
  const [y, m, d] = day.split('-').map(Number)
  const date = new Date(y, (m || 1) - 1, (d || 1) + days)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

const short = (day: string) => `${day.slice(8, 10)}-${day.slice(5, 7)}`

/**
 * Las reglas, iguales en todo el panel:
 *   Hoy / Mañana  ese día.
 *   Semana        de lunes a domingo de la semana en curso.
 *   Mes           el mes calendario en curso.
 *   Rango         entre las dos fechas elegidas (una sola punta también vale).
 *   Todo          sin filtro.
 */
export function resolvePeriod(period: Period, today: string = todayChile()): PeriodRange {
  switch (period.preset) {
    case 'all':
      return { from: null, to: null, label: 'todas las fechas' }
    case 'day':
      return { from: today, to: today, label: 'hoy' }
    case 'tomorrow': {
      const day = addDays(today, 1)
      return { from: day, to: day, label: 'mañana' }
    }
    case 'week': {
      const [y, m, d] = today.split('-').map(Number)
      const weekday = (new Date(y, m - 1, d).getDay() + 6) % 7 // lunes = 0
      const monday = addDays(today, -weekday)
      return { from: monday, to: addDays(monday, 6), label: 'esta semana' }
    }
    case 'month': {
      const [y, m] = today.split('-').map(Number)
      const last = new Date(y, m, 0).getDate()
      return { from: `${today.slice(0, 8)}01`, to: `${today.slice(0, 8)}${String(last).padStart(2, '0')}`, label: 'este mes' }
    }
    case 'custom': {
      const from = period.from || null
      const to = period.to || null
      if (from && to && from > to) return { from: to, to: from, label: `${short(to)} al ${short(from)}` }
      const label = from && to ? `${short(from)} al ${short(to)}` : from ? `desde el ${short(from)}` : to ? `hasta el ${short(to)}` : 'todas las fechas'
      return { from, to, label }
    }
  }
}

/** ¿Cae este día ('YYYY-MM-DD…') dentro del rango? Sin fecha solo pasa si no hay filtro. */
export function inPeriod(day: string | null | undefined, range: PeriodRange): boolean {
  if (!range.from && !range.to) return true
  const value = String(day || '').slice(0, 10)
  if (!value) return false
  if (range.from && value < range.from) return false
  if (range.to && value > range.to) return false
  return true
}

export const periodOf = (preset: PeriodPreset, from = '', to = ''): Period => ({ preset, from, to })

const monthName = new Intl.DateTimeFormat('es-CL', { month: 'long', year: 'numeric', timeZone: 'UTC' })

/** El mes calendario completo, `back` meses antes del de `today`, con su nombre («octubre de 2026»). */
export function monthRange(today: string, back = 0): { from: string; to: string; name: string } {
  const [y, m] = today.split('-').map(Number)
  const first = new Date(Date.UTC(y, m - 1 - back, 1, 12))
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0, 12))
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10), name: monthName.format(first) }
}
