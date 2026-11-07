-- Migration: personas requeridas por reserva
-- Date: 2026-10-06
-- Rama: feat/detalle-operacional-reserva.
--
-- La cantidad de personas que pide un trabajo sale de la cotización
-- (`quote_prospects.additional_services.totalCrew`), pero las reservas cargadas a mano no
-- tienen cotización: 101 de las 175 reservas reales desde agosto de 2026 (medido el
-- 06-10-2026). Para esas el dato nunca se guardó en ninguna parte.
--
-- QUÉ AGREGA
--   bookings.people_needed   personas que pide el trabajo, chofer incluido, puesto a mano
--                            desde el detalle de la reserva. NULL = se usa lo que diga la
--                            cotización, si hay.
--
-- ES SOLO ADITIVA. Se puede correr dos veces. Sin ella el detalle muestra lo de la
-- cotización y avisa que falta la migración al intentar guardar el número a mano.

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS people_needed INTEGER
  CHECK (people_needed IS NULL OR (people_needed >= 1 AND people_needed <= 20));

COMMENT ON COLUMN bookings.people_needed IS
  'Personas que pide el trabajo (chofer incluido), puestas a mano. NULL = lo que diga la cotización.';
