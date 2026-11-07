-- Migration: estado completo del cotizador en cada cotización
-- Date: 2026-10-08
-- Rama: feat/retomar-cotizacion.
--
-- QUÉ AGREGA
--   quote_prospects.quote_state   copia de lo que el cliente cargó en el cotizador
--                                 (direcciones por campo, tipo de propiedad, ítems con peso
--                                 y categoría, servicios), para poder retomar la cotización
--                                 desde «Mi cuenta» con todo ya cargado.
--
-- ES SOLO ADITIVA. Se puede correr dos veces. Sin ella las cotizaciones se siguen guardando
-- igual que antes y el botón «Retomar» simplemente no aparece. Las cotizaciones anteriores a
-- la migración quedan en NULL: no se pueden retomar, se ofrecen como hasta ahora.

ALTER TABLE quote_prospects ADD COLUMN IF NOT EXISTS quote_state JSONB;
