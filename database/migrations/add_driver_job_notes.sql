-- Migration: notas que el chofer escribe desde su link
-- Date: 2026-09-02
-- Punto 2 de la reunión del 1-sep: "el chofer pueda poner notas a través del link para
-- el trabajo realizado".
--
-- POR QUÉ UNA TABLA Y NO UNA COLUMNA
-- `bookings.notes` ya existe y es la nota que escribe el ADMIN antes del trabajo (sale en
-- los dos PDF). Lo que escribe el chofer es otra cosa: es lo que PASÓ en el trabajo, se
-- escribe después, y no debe poder pisar lo que puso el admin.
--
-- Además va como varias filas y no como un campo editable porque:
--   - En un camión puede haber más de una persona, y en un trabajo pasan varias cosas.
--     Con un solo campo, el segundo en escribir pisa al primero sin enterarse.
--   - Queda registrado CUÁNDO y desde el link de QUÉ CAMIÓN se escribió, que es lo que
--     permite reconstruir un día cuando algo salió mal.
--   - Son append-only: el chofer agrega, nadie edita ni borra desde el link público.

CREATE TABLE IF NOT EXISTS booking_driver_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  note TEXT NOT NULL CHECK (LENGTH(TRIM(note)) > 0),
  -- Camión desde cuyo link se escribió. NULL si vino del link general heredado.
  vehicle_id INTEGER,
  -- Nombre del camión/chofer congelado al momento de escribir: si después se renombra
  -- el camión o cambia de chofer, la nota vieja sigue diciendo quién la puso.
  vehicle_label TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS booking_driver_notes_booking_id_idx
  ON booking_driver_notes (booking_id, created_at DESC);

COMMENT ON TABLE booking_driver_notes IS
  'Notas que el chofer escribe desde /trabajos/<token> sobre el trabajo realizado. Append-only. Distintas de bookings.notes, que es la nota del admin.';
