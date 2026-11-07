/**
 * Reprogramación de una reserva desde el Panel del Cliente (Módulo 1, paso 4).
 *
 * Reglas decididas por Francisco el 01-10-2026:
 *  1) Se reprograma solo con MÁS DE 48 HORAS de aviso, igual que la cancelación sin cargo
 *     de las Políticas de Garantía. Con menos, el panel deriva a WhatsApp. La regla vale
 *     también para el horario nuevo: mover una mudanza a pasado mañana deja el mismo poco
 *     margen que cambiarla con poco aviso.
 *  2) Solo a días con un recargo IGUAL O MENOR al del día actual (sábado, domingo y
 *     feriado tienen recargo, ver `dateSurcharge`). El precio guardado no cambia; para
 *     pasar a un día más caro, WhatsApp.
 *
 * El cupo se valida en el servidor con la misma cuenta que el calendario del cotizador
 * (`getSlotAvailability`), sin contar a la propia reserva. El cliente nunca puede agendar
 * sobre un horario lleno: eso solo lo hace el admin, confirmando el sobrecupo.
 */

import { supabaseAdmin } from '@/lib/supabase'
import { readPricingConfig } from '@/lib/server/pricingConfigServer'
import { dateSurcharge } from '@/lib/quotePricing'
import { chileTodayString } from '@/lib/vehicleAssignment'
import { getSlotAvailability } from '@/lib/slotAvailability'

export const RESCHEDULE_MIN_HOURS = 48
/** Hasta cuántos días hacia adelante se ofrecen fechas nuevas. */
export const RESCHEDULE_HORIZON_DAYS = 180

export type RescheduleBlock =
  /** Realizada, cancelada o no atendida: no hay nada que mover. */
  | 'status'
  /** Visita a domicilio: no es una mudanza y se agenda por otro flujo. */
  | 'domicilio'
  /** Faltan 48 horas o menos. */
  | 'too_close'
  /** La reserva no tiene fecha u hora. */
  | 'no_schedule'

export interface ReschedulableBooking {
  status?: string | null
  is_provisional?: boolean | null
  booking_type?: string | null
  quote_id?: string | null
  scheduled_date?: string | null
  scheduled_time?: string | null
}

/** Offset de Chile (ms) en un instante dado: hora de Santiago menos UTC. */
function chileOffsetMs(utcMs: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Santiago',
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMs))
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value)
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'))
  return asUtc - utcMs
}

/**
 * Instante (ms UTC) de una fecha y hora de Chile. Vercel corre en UTC y Chile cambia de
 * horario dos veces al año, así que el offset se calcula para ESE día y no se fija.
 */
export function chileDateTimeToUtcMs(date: string, time: string): number {
  const [y, m, d] = date.slice(0, 10).split('-').map(Number)
  const [hh, mi] = String(time || '00:00').split(':').map(Number)
  const guess = Date.UTC(y, m - 1, d, hh || 0, mi || 0)
  // Dos pasadas: la primera puede caer del otro lado de un cambio de horario.
  const first = guess - chileOffsetMs(guess)
  return guess - chileOffsetMs(first)
}

/** ¿Faltan más de 48 horas para esa fecha y hora? */
export function isFarEnough(date: string, time: string, now: number = Date.now()): boolean {
  return chileDateTimeToUtcMs(date, time) - now > RESCHEDULE_MIN_HOURS * 60 * 60 * 1000
}

/** null = se puede reprogramar desde el panel. */
export function rescheduleBlock(b: ReschedulableBooking, now: number = Date.now()): RescheduleBlock | null {
  if (!['confirmed', 'pending'].includes(String(b.status || ''))) return 'status'
  if (b.booking_type === 'domicilio' || String(b.quote_id || '').startsWith('DOMICILIO-')) return 'domicilio'
  if (!b.scheduled_date || !b.scheduled_time) return 'no_schedule'
  if (!isFarEnough(b.scheduled_date, b.scheduled_time, now)) return 'too_close'
  return null
}

function addDaysKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + days))
  return t.toISOString().slice(0, 10)
}

export interface RescheduleDate {
  date: string
  /** false = el día tiene más recargo que el actual: se coordina por WhatsApp. */
  allowed: boolean
  surchargePercent: number
}

/**
 * Días que se ofrecen para mover la reserva: desde pasado mañana (antes no hay ningún
 * horario con más de 48 h) hasta el horizonte, marcando los que tienen más recargo.
 */
export async function rescheduleDates(currentDate: string): Promise<RescheduleDate[]> {
  const pricing = await readPricingConfig()
  const currentPercent = dateSurcharge(currentDate, pricing.timeSurcharges).percent
  const today = chileTodayString()
  const dates: RescheduleDate[] = []
  for (let i = 2; i <= RESCHEDULE_HORIZON_DAYS; i++) {
    const date = addDaysKey(today, i)
    const percent = dateSurcharge(date, pricing.timeSurcharges).percent
    dates.push({ date, allowed: percent <= currentPercent, surchargePercent: percent })
  }
  return dates
}

export interface RescheduleSlot {
  time: string
  label: string
  available: boolean
}

/** Horarios de un día para mover ESTA reserva: cupo (sin contarla a ella) y 48 horas. */
export async function rescheduleSlots(bookingId: string, date: string): Promise<RescheduleSlot[]> {
  const slots = await getSlotAvailability(date, { excludeBookingId: bookingId })
  const now = Date.now()
  return slots.map((s) => ({
    time: s.time,
    label: s.label,
    available: s.isAvailable && isFarEnough(date, s.time, now),
  }))
}

export type RescheduleResult =
  | { ok: true; from: { date: string; time: string }; to: { date: string; time: string } }
  | { ok: false; status: number; error: string }

/**
 * Mueve la reserva. `booking` ya viene leída y filtrada por el cliente de la sesión.
 *
 * Libera el camión (`vehicle_id = null`): el que tenía puede estar ocupado en el horario
 * nuevo, y el reparto automático le asigna uno libre la próxima vez que se arma la agenda.
 * El UPDATE va condicionado a la fecha y hora de antes, así un doble clic o un cambio del
 * admin en paralelo no pisan nada: el segundo no encuentra la fila y responde 409.
 */
export async function rescheduleBooking(
  booking: ReschedulableBooking & { id: string },
  newDate: string,
  newTime: string
): Promise<RescheduleResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate) || !/^\d{2}:\d{2}$/.test(newTime)) {
    return { ok: false, status: 400, error: 'Elige una fecha y un horario.' }
  }

  const block = rescheduleBlock(booking)
  if (block) {
    return {
      ok: false,
      status: 409,
      error:
        block === 'too_close'
          ? 'Faltan 48 horas o menos para tu mudanza: para cambiarla escríbenos por WhatsApp.'
          : 'Esta reserva no se puede reprogramar desde aquí. Escríbenos y te ayudamos.',
    }
  }

  const fromDate = String(booking.scheduled_date)
  const fromTime = String(booking.scheduled_time).slice(0, 5)
  if (newDate === fromDate && newTime === fromTime) {
    return { ok: false, status: 400, error: 'Elige una fecha u horario distinto al actual.' }
  }

  const dates = await rescheduleDates(fromDate)
  const day = dates.find((d) => d.date === newDate)
  if (!day) {
    return { ok: false, status: 400, error: 'Esa fecha no está disponible para reprogramar.' }
  }
  if (!day.allowed) {
    return {
      ok: false,
      status: 409,
      error: 'Ese día tiene un recargo mayor al de tu reserva: para moverla ahí escríbenos por WhatsApp.',
    }
  }

  const slots = await rescheduleSlots(booking.id, newDate)
  const slot = slots.find((s) => s.time.slice(0, 5) === newTime)
  if (!slot || !slot.available) {
    return { ok: false, status: 409, error: 'Ese horario ya no está disponible. Elige otro.' }
  }

  const { data, error } = await supabaseAdmin
    .from('bookings')
    .update({ scheduled_date: newDate, scheduled_time: newTime, vehicle_id: null })
    .eq('id', booking.id)
    .eq('scheduled_date', fromDate)
    .eq('scheduled_time', String(booking.scheduled_time))
    .select('id')
    .maybeSingle()

  if (error) {
    console.error('[customerReschedule] Error moviendo la reserva:', error)
    return { ok: false, status: 500, error: 'No pudimos cambiar la fecha. Intenta de nuevo.' }
  }
  if (!data) {
    return { ok: false, status: 409, error: 'Tu reserva cambió mientras tanto. Recarga la página.' }
  }

  return { ok: true, from: { date: fromDate, time: fromTime }, to: { date: newDate, time: newTime } }
}
