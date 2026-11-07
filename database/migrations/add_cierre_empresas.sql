-- Migration: tarifa por empresa en UF por tramos, urgencia y cierre por pallets o kg
-- Date: 2026-10-20 (reemplaza la versión del 15-10, que no se alcanzó a correr)
-- Rama: release/pedidos-tomas. Pedido de Tomás para Monfiza (respuestas del 19-10-2026).
--
-- QUÉ AGREGA
--   companies.closing_unit         unidad con que se cierra normalmente la empresa: 'pallets'
--                                  o 'kg'. Cada reserva puede usar la otra. NULL = la empresa
--                                  no se cierra por unidad (como hoy).
--   companies.tariff_currency      'UF' o 'CLP', para el precio por tramo y la urgencia.
--   companies.tramo_price          precio NETO por tramo (Monfiza: 1,28 UF + IVA).
--   companies.tramo_pallets        pallets por tramo (Monfiza: hasta 2).
--   companies.tramo_kg             kilos por tramo (Monfiza: hasta 1.000).
--   companies.urgency_price        recargo NETO por trabajo urgente (Monfiza: 0,29 UF + IVA).
--   bookings.pallets               pallets entregados (también la agrega
--                                  add_nomina_y_pago_por_trabajo.sql; da igual cuál corra primero).
--   bookings.delivery_kg           kilos entregados.
--   bookings.delivery_unit         'pallets' o 'kg': cómo se cobra ESTA reserva.
--   bookings.od_number             N° de OD de la entrega.
--   bookings.guide_number          N° de guía o factura de la entrega.
--   bookings.is_urgent             trabajo urgente: suma el recargo.
--   bookings.price_uf              monto NETO de la reserva en UF, puesto por el cierre. Los
--                                  pesos se fijan al facturar, con la UF del día de la factura.
--   company_closings               cada cierre guardado de una empresa, con una copia del detalle.
--
-- Tarifa de Monfiza (EMP-00008), de las respuestas de Tomás: se carga aquí para no tipearla.
--
-- ES ADITIVA. Se puede correr dos veces. Sin ella la ficha de la empresa y el panel del
-- trabajador siguen como hoy.

ALTER TABLE companies ADD COLUMN IF NOT EXISTS closing_unit TEXT
  CHECK (closing_unit IS NULL OR closing_unit IN ('pallets', 'kg'));
ALTER TABLE companies ADD COLUMN IF NOT EXISTS tariff_currency TEXT NOT NULL DEFAULT 'UF'
  CHECK (tariff_currency IN ('UF', 'CLP'));
ALTER TABLE companies ADD COLUMN IF NOT EXISTS tramo_price NUMERIC
  CHECK (tramo_price IS NULL OR tramo_price >= 0);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS tramo_pallets NUMERIC
  CHECK (tramo_pallets IS NULL OR tramo_pallets > 0);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS tramo_kg NUMERIC
  CHECK (tramo_kg IS NULL OR tramo_kg > 0);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS urgency_price NUMERIC
  CHECK (urgency_price IS NULL OR urgency_price >= 0);

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS pallets INTEGER
  CHECK (pallets IS NULL OR pallets >= 0);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS delivery_kg NUMERIC
  CHECK (delivery_kg IS NULL OR delivery_kg >= 0);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS delivery_unit TEXT
  CHECK (delivery_unit IS NULL OR delivery_unit IN ('pallets', 'kg'));
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS od_number TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS guide_number TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS is_urgent BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS price_uf NUMERIC
  CHECK (price_uf IS NULL OR price_uf >= 0);

CREATE TABLE IF NOT EXISTS company_closings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  period_from DATE NOT NULL,
  period_to DATE NOT NULL,
  unit TEXT NOT NULL CHECK (unit IN ('pallets', 'kg')),
  uf_value NUMERIC,
  total_clp INTEGER NOT NULL,
  detail JSONB NOT NULL,
  closed_by TEXT,
  closed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reopened_by TEXT,
  reopened_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS company_closings_company_idx ON company_closings (company_id, period_from);

ALTER TABLE company_closings ENABLE ROW LEVEL SECURITY;

-- Tarifa de Monfiza (Tomás, 19-10-2026). Solo si todavía no tiene una.
UPDATE companies
SET closing_unit = 'pallets', tariff_currency = 'UF', tramo_price = 1.28, tramo_pallets = 2, tramo_kg = 1000, urgency_price = 0.29
WHERE code = 'EMP-00008' AND tramo_price IS NULL;
