import { supabaseAdmin } from '@/lib/supabase'

// Notas que el chofer escribe desde /trabajos/<token> sobre el trabajo realizado.
// Se agregan y no se borran. Quien escribió una nota puede corregirla (`updateDriverNote`):
// desde el mismo link de camión o la misma sesión de trabajador que la escribió.
//
// Son distintas de `bookings.notes`, que es la nota del ADMIN escrita ANTES del trabajo y
// que sale en los PDF. El chofer no puede tocar esa.

// Los tipos y la constante viven en driverNotesTypes.ts (sin imports de servidor) para
// que un componente cliente pueda usarlos sin arrastrar supabaseAdmin. Se re-exportan
// acá para no romper a quien ya importaba desde este módulo.
export { DRIVER_NOTE_MAX_LENGTH, type DriverNote } from '@/lib/driverNotesTypes'
import { DRIVER_NOTE_MAX_LENGTH, type DriverNote } from '@/lib/driverNotesTypes'

/** 42P01 = undefined_table: falta correr add_driver_job_notes.sql. */
function isMissingTable(error: { code?: string } | null): boolean {
  return error?.code === '42P01'
}

export async function isDriverNotesAvailable(): Promise<boolean> {
  const { error } = await supabaseAdmin.from('booking_driver_notes').select('id').limit(1)
  if (!error) return true
  if (!isMissingTable(error)) {
    console.error('[driverNotes] No se pudo comprobar la tabla:', error.message)
  }
  return false
}

/**
 * Notas de varias reservas de una sola consulta, agrupadas por reserva.
 * Se usa así para no hacer una query por trabajo al pintar la agenda del chofer.
 */
export async function getDriverNotesFor(
  bookingIds: string[]
): Promise<Map<string, DriverNote[]>> {
  const out = new Map<string, DriverNote[]>()
  if (bookingIds.length === 0) return out

  const { data, error } = await supabaseAdmin
    .from('booking_driver_notes')
    .select('id, booking_id, note, vehicle_id, vehicle_label, created_at')
    .in('booking_id', bookingIds)
    .order('created_at', { ascending: true })

  if (error) {
    // Sin la migración aplicada la agenda tiene que seguir funcionando: simplemente no
    // hay notas todavía.
    if (!isMissingTable(error)) {
      console.error('[driverNotes] Error leyendo notas:', error.message)
    }
    return out
  }

  for (const row of (data || []) as DriverNote[]) {
    const list = out.get(row.booking_id) || []
    list.push(row)
    out.set(row.booking_id, list)
  }
  return out
}

export interface AddDriverNoteResult {
  ok: boolean
  error?: string
  note?: DriverNote
}

/** Agrega una nota. El llamador YA debe haber verificado que el chofer puede ver ese trabajo. */
export async function addDriverNote(params: {
  bookingId: string
  note: string
  vehicleId: number | null
  vehicleLabel: string | null
}): Promise<AddDriverNoteResult> {
  const note = String(params.note || '').trim()
  if (!note) return { ok: false, error: 'La nota está vacía' }
  if (note.length > DRIVER_NOTE_MAX_LENGTH) {
    return { ok: false, error: `La nota no puede pasar de ${DRIVER_NOTE_MAX_LENGTH} caracteres` }
  }

  const { data, error } = await supabaseAdmin
    .from('booking_driver_notes')
    .insert({
      booking_id: params.bookingId,
      note,
      vehicle_id: params.vehicleId,
      vehicle_label: params.vehicleLabel,
    })
    .select('id, booking_id, note, vehicle_id, vehicle_label, created_at')
    .single()

  if (error) {
    if (isMissingTable(error)) {
      console.warn('[driverNotes] Falta la tabla (¿sin correr add_driver_job_notes.sql?)')
      return { ok: false, error: 'Las notas todavía no están habilitadas. Avisale al administrador.' }
    }
    console.error('[driverNotes] Error guardando la nota:', error.message)
    return { ok: false, error: 'No se pudo guardar la nota' }
  }

  return { ok: true, note: data as DriverNote }
}

/**
 * Corrige el texto de una nota. Solo la cambia si es de esa reserva Y la escribió ese mismo
 * autor (`vehicle_label`, que queda congelado al escribirla): desde el link del Camión 1 no
 * se editan las notas del Camión 2 ni las de un trabajador con sesión propia. El llamador
 * YA debe haber verificado que el chofer puede ver ese trabajo.
 */
export async function updateDriverNote(params: {
  noteId: string
  bookingId: string
  note: string
  authorLabel: string | null
}): Promise<AddDriverNoteResult> {
  const note = String(params.note || '').trim()
  if (!note) return { ok: false, error: 'La nota está vacía' }
  if (note.length > DRIVER_NOTE_MAX_LENGTH) {
    return { ok: false, error: `La nota no puede pasar de ${DRIVER_NOTE_MAX_LENGTH} caracteres` }
  }
  if (!params.authorLabel) return { ok: false, error: 'Esa nota no es tuya' }

  const { data, error } = await supabaseAdmin
    .from('booking_driver_notes')
    .update({ note })
    .eq('id', params.noteId)
    .eq('booking_id', params.bookingId)
    .eq('vehicle_label', params.authorLabel)
    .select('id, booking_id, note, vehicle_id, vehicle_label, created_at')
    .maybeSingle()
  if (error) {
    console.error('[driverNotes] Error editando la nota:', error.message)
    return { ok: false, error: 'No se pudo guardar la nota' }
  }
  if (!data) return { ok: false, error: 'Esa nota no es tuya o ya no existe' }
  return { ok: true, note: data as DriverNote }
}
