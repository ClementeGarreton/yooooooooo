-- Migration: servicio de pallets y tarifa prioritaria en las solicitudes de empresa
-- Date: 2026-10-20
-- Rama: feat/empresas-pallets-prioritaria. Pedido de Tomás (20-10-2026), panel de empresas:
--   - «Pallets» como servicio nuevo al pedir: cantidad de pallets y notas (no obligatorias)
--     y la opción de repaletizar (su monto se cambia en Configuración → Precios).
--   - En los trabajos de pallets el trabajador anota el N° de guía de despacho o de factura
--     (obligatorio para finalizar; no va en la solicitud, se sabe al retirar).
--   - Trabajos pedidos con menos de 24 h de anticipación: tarifa prioritaria, que el cliente
--     acepta al enviar la solicitud.
--
-- QUÉ AGREGA
--   service_requests.service_type      admite 'pallets' (además de mudanza, transporte, carga).
--   service_requests.pallets           cantidad de pallets que pidió (opcional).
--   service_requests.repalletize       pidió repaletizar.
--   service_requests.is_priority       pedida con menos de 24 h: va con tarifa prioritaria.
--   service_requests.priority_accepted_at  cuándo aceptó la tarifa prioritaria y los términos.
--   bookings.service_type              'pallets' en los trabajos de pallets (NULL = como hoy).
--   bookings.repalletize               el trabajo incluye repaletizar.
--   (bookings.pallets, bookings.guide_number e bookings.is_urgent ya existen:
--    add_cierre_empresas.sql.)
--
-- ES ADITIVA (el CHECK de service_type solo se amplía). Se puede correr dos veces. Sin ella
-- el formulario no ofrece «Pallets» y lo demás sigue como hoy.

ALTER TABLE service_requests DROP CONSTRAINT IF EXISTS service_requests_service_type_check;
ALTER TABLE service_requests ADD CONSTRAINT service_requests_service_type_check
  CHECK (service_type IN ('mudanza', 'transporte', 'carga', 'pallets'));

ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS pallets INTEGER
  CHECK (pallets IS NULL OR pallets >= 0);
ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS repalletize BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS is_priority BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS priority_accepted_at TIMESTAMPTZ;

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS service_type TEXT
  CHECK (service_type IS NULL OR service_type IN ('mudanza', 'transporte', 'carga', 'pallets'));
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS repalletize BOOLEAN NOT NULL DEFAULT FALSE;
