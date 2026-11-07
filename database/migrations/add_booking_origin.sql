-- Migration: origen de cada reserva (web o ingresada a mano)
-- Date: 2026-10-15
-- Rama: feat/origen-e-inventario.
--
-- QUÉ AGREGA
--   bookings.created_via   'admin' = la ingresó alguien del equipo desde el panel (reserva
--                          manual o lead convertido). NULL = la tomó el cliente en la web.
--
-- ES ADITIVA y se puede correr dos veces. Además MARCA las reservas manuales anteriores: las
-- de ID «ADMIN-…» y las que el registro de actividad muestra creadas desde el panel. Las
-- manuales anteriores al registro de actividad y sin ID «ADMIN-…» quedan como web.

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS created_via TEXT
  CHECK (created_via IS NULL OR created_via IN ('admin'));

UPDATE bookings
SET created_via = 'admin'
WHERE created_via IS NULL
  AND (
    quote_id LIKE 'ADMIN-%'
    OR id::text IN (
      SELECT entity_id FROM admin_activity_log
      WHERE action IN ('booking.created', 'prospect.converted_to_booking') AND entity_id IS NOT NULL
    )
  );
