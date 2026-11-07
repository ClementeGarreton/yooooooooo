-- Migration: pago a trabajadores por m³ y kilometraje, con bonificaciones
-- Date: 2026-10-10
-- Rama: feat/pago-m3-km.
--
-- QUÉ AGREGA
--   worker_pay_config.rate_m3 / rate_km   pesos por m³ y por km de la regla general.
--   worker_pay_config.mode                acepta además 'm3km' (se reemplaza el CHECK del
--                                         modo por uno que incluye el valor nuevo; los
--                                         valores existentes siguen siendo válidos).
--   workers.pay_rate_m3 / pay_rate_km     tarifa propia de un trabajador por m³ y por km.
--   worker_bonuses                        bonificaciones cargadas a mano a un trabajador.
--
-- No borra ni modifica datos. Se puede correr dos veces. Sin ella siguen funcionando el
-- monto fijo y el porcentaje, y el panel avisa que falta para usar m³/km y bonificaciones.

ALTER TABLE worker_pay_config ADD COLUMN IF NOT EXISTS rate_m3 NUMERIC(10,2)
  CHECK (rate_m3 IS NULL OR rate_m3 >= 0);
ALTER TABLE worker_pay_config ADD COLUMN IF NOT EXISTS rate_km NUMERIC(10,2)
  CHECK (rate_km IS NULL OR rate_km >= 0);

ALTER TABLE worker_pay_config DROP CONSTRAINT IF EXISTS worker_pay_config_mode_check;
ALTER TABLE worker_pay_config ADD CONSTRAINT worker_pay_config_mode_check
  CHECK (mode IN ('fijo', 'porcentaje', 'm3km'));

ALTER TABLE workers ADD COLUMN IF NOT EXISTS pay_rate_m3 NUMERIC(10,2)
  CHECK (pay_rate_m3 IS NULL OR pay_rate_m3 >= 0);
ALTER TABLE workers ADD COLUMN IF NOT EXISTS pay_rate_km NUMERIC(10,2)
  CHECK (pay_rate_km IS NULL OR pay_rate_km >= 0);

CREATE TABLE IF NOT EXISTS worker_bonuses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id UUID NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  bonus_date DATE NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  note TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS worker_bonuses_worker_idx ON worker_bonuses (worker_id, bonus_date DESC);

ALTER TABLE worker_bonuses ENABLE ROW LEVEL SECURITY;
