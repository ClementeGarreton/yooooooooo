-- Migration: clientes independientes + origen "Cliente antiguo"
-- Date: 2026-08-19
--
-- Las fichas de cliente independientes se guardan en quote_prospects con
-- status='converted' y sin converted_booking_id hasta que exista una reserva.
-- Esto mantiene una sola base de contactos y permite que las reservas manuales
-- queden enlazadas a su origen para desglosar la facturacion.

ALTER TABLE quote_prospects
  DROP CONSTRAINT IF EXISTS quote_prospects_source_check;

ALTER TABLE quote_prospects
  ADD CONSTRAINT quote_prospects_source_check
  CHECK (
    source IN (
      'web',
      'pdf_download',
      'email_quote',
      'checkout_initiated',
      'domicilio',
      'rrss',
      'recomendacion',
      'cliente_antiguo'
    )
  );

COMMENT ON COLUMN quote_prospects.source IS
  'Origen comercial: web (incluye origenes tecnicos del sitio), rrss, recomendacion o cliente_antiguo.';
