-- Migration: observaciones de cada trabajo en el cierre de empresas
-- Date: 2026-10-27
-- Rama: feat/cierre-observaciones. Francisco (27-10-2026): el PDF del cierre (formato del
-- «Cierre Agosto 2026 Monfiza final.pdf» de Tomás) lleva observaciones escritas a mano por
-- trabajo: «Autorizado por Philip», «Entregado en Transportes Vilicic, Lampa», «Corresponde a
-- 36 kg: no aplica cobro de 3 pallets».
--
-- QUÉ AGREGA
--   bookings.closing_note   observación del trabajo para el cierre de la empresa. La escribe
--                           la oficina en Empresas → ficha → Cierre; sale en el PDF y el Excel.
--
-- ES ADITIVA. Se puede correr dos veces.

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS closing_note TEXT
  CHECK (closing_note IS NULL OR char_length(closing_note) <= 300);
