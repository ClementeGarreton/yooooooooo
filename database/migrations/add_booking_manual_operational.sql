-- Migration: volumen y distancia puestos a mano en la reserva
-- Date: 2026-10-06
-- Rama: feat/nueva-reserva-datos-operacionales.
--
-- El volumen (m³) y la distancia (km) de un trabajo viven en la cotización. Las reservas
-- cargadas a mano no tienen una cotización propia: su ficha de contacto se comparte por
-- correo entre todas las reservas de esa persona, así que no sirve para guardar datos de UNA
-- reserva. Para esas (101 de 175 desde agosto de 2026) el dato no tenía dónde ir.
--
-- QUÉ AGREGA
--   bookings.volume_m3     volumen puesto a mano. NULL = lo que diga la cotización.
--   bookings.distance_km   distancia puesta a mano. NULL = lo que diga la cotización.
-- (Las personas requeridas ya tienen su columna: add_booking_people_needed.sql.)
--
-- ES SOLO ADITIVA. Se puede correr dos veces. Sin ella «Nueva reserva» guarda todo lo demás
-- y avisa que estos dos datos no quedaron.

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS volume_m3 NUMERIC(7,2)
  CHECK (volume_m3 IS NULL OR (volume_m3 > 0 AND volume_m3 <= 500));
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS distance_km NUMERIC(7,1)
  CHECK (distance_km IS NULL OR (distance_km > 0 AND distance_km <= 5000));

COMMENT ON COLUMN bookings.volume_m3 IS 'Volumen (m³) puesto a mano. NULL = el de la cotización.';
COMMENT ON COLUMN bookings.distance_km IS 'Distancia (km) puesta a mano. NULL = la de la cotización.';
