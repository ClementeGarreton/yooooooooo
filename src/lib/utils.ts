import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: 'CLP',
  }).format(amount)
}

export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('es-CL', {
    dateStyle: 'full',
  }).format(date)
}

export function formatTime(date: Date): string {
  return new Intl.DateTimeFormat('es-CL', {
    timeStyle: 'short',
  }).format(date)
}

/**
 * ¿La fecha de la mudanza ya no se puede reservar? El calendario del cotizador parte mañana.
 * La fecha queda guardada en el navegador (quote-storage): Tomás cotizó el 27-10-2026 y salió
 * con el 22-08, la fecha de una cotización suya de agosto.
 */
export function isPastMoveDate(date: Date | string | null | undefined): boolean {
  if (!date) return false
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  tomorrow.setHours(0, 0, 0, 0)
  return new Date(date).getTime() < tomorrow.getTime()
}

/**
 * Formatea una distancia guardada en km (puede venir con decimales, ej. mudanzas
 * dentro de un mismo edificio/condominio) a metros si es menor a 1km, o a km con
 * un decimal en caso contrario. Antes siempre se mostraba en km redondeados a
 * entero, por lo que un traslado "puerta a puerta" de 80m aparecía como "0 km".
 */
export function formatDistanceKm(km: number): string {
  if (km < 1) {
    return `${Math.round(km * 1000)} m`
  }
  return `${km.toFixed(1)} km`
}

/**
 * Convierte la "distancia del estacionamiento a la puerta" (valor representativo del
 * cotizador: 0, 20, 40, 60) a un rango legible para los PDF. Es cuánto tienen que
 * acarrear los trabajadores entre el camión y la puerta, así que interesa el rango,
 * no un número exacto. El valor 0 significa "en la puerta" (sin acarreo extra) y ahora
 * se muestra explícitamente: la línea solo se omite (devuelve null) cuando el dato no
 * existe (null/undefined/NaN), no cuando es 0.
 */
export function formatParkingDistance(value?: number | null): string | null {
  if (typeof value !== 'number' || Number.isNaN(value)) return null
  if (value <= 0) return 'En la puerta'
  if (value <= 20) return 'menos de 20 m'
  if (value <= 40) return 'entre 20 y 40 m'
  return 'más de 40 m'
}

export function generateId(): string {
  return Math.random().toString(36).substring(2, 9)
}

export function validateEmail(email: string): boolean {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return re.test(email)
}

export function validatePhone(phone: string): boolean {
  // Cualquier teléfono: entre 8 y 15 dígitos, con o sin «+», espacios, guiones o paréntesis.
  // Antes solo pasaban los móviles chilenos cuyo segundo dígito era 3–9, y quedaban fuera
  // números reales (+56 9 2620 8908, 05-oct-2026), fijos y extranjeros: el cliente no podía
  // cotizar. Un teléfono mal escrito se corrige después; un cliente que no puede avanzar se pierde.
  const raw = String(phone || '').trim()
  if (!/^\+?[\d\s().-]+$/.test(raw)) return false
  const digits = raw.replace(/\D/g, '')
  return digits.length >= 8 && digits.length <= 15
}

/**
 * Normaliza un teléfono chileno al formato canónico "+56 9 XXXX XXXX".
 * Acepta entradas como "9 7602 0510", "976020510", "+56976020510", "56 9 7602 0510".
 * Si el número no calza con un móvil chileno válido, devuelve el valor original
 * (no rompe entradas raras). Garantiza que el enlace de WhatsApp siempre funcione.
 */
export function normalizeChileanPhone(phone: string): string {
  let digits = (phone || '').replace(/\D/g, '')
  if (digits.startsWith('56')) digits = digits.slice(2)
  if (digits.length === 8) digits = '9' + digits // faltaba el 9 inicial del móvil
  if (digits.length === 9 && digits.startsWith('9')) {
    return `+56 9 ${digits.slice(1, 5)} ${digits.slice(5, 9)}`
  }
  return phone
}

export function sanitizeInput(input: string): string {
  return input.trim().replace(/[<>]/g, '')
}

