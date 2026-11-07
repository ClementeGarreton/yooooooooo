-- Migration: Guarda el visitor id en la cotizacion
-- Date: 2026-10-30
-- Description: La cookie `_vla` identifica las visitas registradas en el collector de
--              Vanlook. Hasta ahora la cotizacion solo guardaba gclid/UTM, asi que quien
--              llegaba sin clic (Google organico, redes, Maps) quedaba sin origen medido.
--
-- Idempotente: se puede correr varias veces sin error.

ALTER TABLE quote_prospects
  ADD COLUMN IF NOT EXISTS visitor_id text;

COMMENT ON COLUMN quote_prospects.visitor_id IS 'Cookie _vla del visitante. Une la cotizacion con sus visitas en el dashboard de atribucion.';
