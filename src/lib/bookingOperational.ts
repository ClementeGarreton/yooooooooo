/**
 * Datos operacionales que una reserva puede llevar puestos a mano: personas requeridas,
 * volumen y distancia. Para las reservas que vienen del cotizador esos datos salen de la
 * cotización; acá se guarda solo lo que alguien corrige o carga a mano.
 *
 * Columnas de add_booking_people_needed.sql y add_booking_manual_operational.sql. Todo es
 * tolerante a que falten: se guarda lo que se puede y se dice qué no.
 */

import { supabaseAdmin } from '@/lib/supabase'

export interface OperationalOverrides {
  peopleNeeded?: number | null
  volumeM3?: number | null
  distanceKm?: number | null
}

const FIELDS = {
  peopleNeeded: { column: 'people_needed', label: 'personas', min: 1, max: 20, integer: true, migration: 'add_booking_people_needed.sql' },
  volumeM3: { column: 'volume_m3', label: 'volumen', min: 0.01, max: 500, integer: false, migration: 'add_booking_manual_operational.sql' },
  distanceKm: { column: 'distance_km', label: 'distancia', min: 0.1, max: 5000, integer: false, migration: 'add_booking_manual_operational.sql' },
} as const

type FieldKey = keyof typeof FIELDS

export class OperationalError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message)
    this.name = 'OperationalError'
  }
}

/** Valida lo que venga en el body. `undefined` = no vino; `null` = borrar. */
export function parseOperationalOverrides(body: any): OperationalOverrides {
  const out: OperationalOverrides = {}
  for (const key of Object.keys(FIELDS) as FieldKey[]) {
    const raw = body?.[key]
    if (raw === undefined) continue
    if (raw === null || raw === '') {
      out[key] = null
      continue
    }
    const spec = FIELDS[key]
    const n = spec.integer ? Math.round(Number(raw)) : Math.round(Number(String(raw).replace(',', '.')) * 100) / 100
    if (!Number.isFinite(n) || n < spec.min || n > spec.max) {
      throw new OperationalError(`El dato de ${spec.label} no es válido (entre ${spec.min} y ${spec.max}).`)
    }
    out[key] = n
  }
  return out
}

/** Lee lo puesto a mano desde una fila de `bookings` leída con `*`. */
export function readOperationalOverrides(row: Record<string, any>) {
  const value = (column: string) => (row[column] === null || row[column] === undefined ? null : Number(row[column]))
  return {
    peopleAvailable: 'people_needed' in row,
    manualAvailable: 'volume_m3' in row && 'distance_km' in row,
    peopleOverride: value('people_needed'),
    volumeOverride: value('volume_m3'),
    distanceOverride: value('distance_km'),
  }
}

/**
 * Guarda los datos puestos a mano, uno por uno: si falta la migración de uno, los demás
 * igual quedan. Devuelve los que no se pudieron guardar, con su migración.
 */
export async function saveOperationalOverrides(bookingId: string, overrides: OperationalOverrides): Promise<string[]> {
  const failed: string[] = []
  for (const key of Object.keys(overrides) as FieldKey[]) {
    const spec = FIELDS[key]
    const { error } = await supabaseAdmin.from('bookings').update({ [spec.column]: overrides[key] }).eq('id', bookingId)
    if (error) {
      console.warn(`[bookingOperational] No se guardó ${spec.column}:`, error.message)
      failed.push(`${spec.label} (falta ${spec.migration})`)
    }
  }
  return failed
}
