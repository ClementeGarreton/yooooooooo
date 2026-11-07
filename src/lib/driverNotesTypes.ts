// Tipos y constantes de las notas del chofer, SIN dependencias de servidor.
//
// Viven aparte de `driverNotes.ts` a propósito: ese módulo importa `supabaseAdmin`, y
// `src/lib/supabase.ts` hace `throw` en el top-level si falta SUPABASE_SERVICE_ROLE_KEY.
// Esa variable no es NEXT_PUBLIC_, así que en el navegador es undefined: cualquier
// componente 'use client' que importara un VALOR desde `driverNotes.ts` arrastraba el
// módulo entero al bundle del cliente y reventaba al hidratar con "Application error:
// a client-side exception has occurred". Pasó con DriverJobNotes el 2026-09-08.
//
// Regla: lo que consuma un componente cliente va acá; lo que toque la base, en driverNotes.ts.

/** Tope de largo. Es una nota operativa, no un informe. */
export const DRIVER_NOTE_MAX_LENGTH = 2000

export interface DriverNote {
  id: string
  booking_id: string
  note: string
  vehicle_id: number | null
  vehicle_label: string | null
  created_at: string
}
