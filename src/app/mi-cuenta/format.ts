// Formato de fechas, horas y montos del Panel del Cliente. Lo usan la página (servidor)
// y las tarjetas con acciones (cliente), así que no puede depender de nada del servidor.

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

/** 'YYYY-MM-DD' → '14 sep 2026', sin pasar por Date (que la correría a UTC). */
export function formatDate(value: string | null): string {
  if (!value) return 'Fecha por definir'
  const [y, m, d] = value.slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return value
  return `${d} ${MONTHS[m - 1]} ${y}`
}

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
const MONTHS_LONG = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]

/**
 * 'YYYY-MM-DD' → 'Lunes 14 de septiembre de 2026'. El día de la semana se saca en UTC
 * a partir de la fecha sola, así no depende del huso del servidor ni del navegador.
 */
export function formatLongDate(value: string | null): string {
  if (!value) return 'Fecha por definir'
  const [y, m, d] = value.slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return value
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
  return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)} ${d} de ${MONTHS_LONG[m - 1]} de ${y}`
}

/** m³ con coma decimal, como se escriben en Chile: 18,6 m³. */
export function formatVolume(m3: number): string {
  return `${m3.toLocaleString('es-CL', { maximumFractionDigits: 1 })} m³`
}

export function formatTime(value: string | null): string {
  return value ? ` · ${value.slice(0, 5)}` : ''
}

export function clp(value: number): string {
  return `$${Math.round(value).toLocaleString('es-CL')}`
}

export function route(origin: string | null, destination: string | null): string {
  if (origin && destination) return `${origin} → ${destination}`
  return origin || destination || 'Dirección por definir'
}
