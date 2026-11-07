-- Migration: documento tributario de cada reserva (boleta, factura o sin documento)
-- Date: 2026-09-24
-- Pedido de Tomás: marcar en cada cobro qué documento se emite y ver el IVA desglosado.
--
-- QUÉ GUARDA
-- Un documento por RESERVA (decisión del 24-sep: el abono y el saldo de un mismo servicio
-- van con el mismo documento). NULL = «sin definir»: las reservas que ya existen quedan
-- así a propósito, para no inventar un dato tributario; se marcan a mano.
--
-- EL IVA NO SE GUARDA
-- Se calcula: el precio de la reserva ya incluye IVA (el cotizador le suma el 19% a las
-- empresas), así que neto = total / 1,19 y el IVA es la diferencia. Guardarlo sería una
-- segunda copia del mismo número que se desalinea el día que se reajusta el precio.
--
-- ES SEGURO CORRERLA ANTES O DESPUÉS DEL DEPLOY
-- El panel pide la columna y, si todavía no existe, sigue funcionando sin ella; lo único
-- que no se puede hacer hasta correr esto es MARCAR el documento (avisa con un mensaje).
-- Se puede correr más de una vez.

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS tax_document text;

ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_tax_document_check;
ALTER TABLE bookings
  ADD CONSTRAINT bookings_tax_document_check
  CHECK (tax_document IS NULL OR tax_document IN ('boleta', 'factura', 'sin_documento'));

COMMENT ON COLUMN bookings.tax_document IS
  'Documento tributario del servicio: boleta, factura o sin_documento. NULL = sin definir.';
