-- Migration: regla de pago a trabajadores (monto fijo o porcentaje)
-- Date: 2026-10-08
-- Rama: feat/contabilidad.
--
-- QUÉ AGREGA
--   worker_pay_config    la regla general, una sola fila: `mode` = 'fijo' (pesos por trabajo)
--                        o 'porcentaje' (del valor del servicio), y su `value`. Se edita en
--                        Configuración → Pago a trabajadores.
--   workers.pay_percent  porcentaje propio de un trabajador. Junto con `pay_per_job` (monto
--                        fijo propio, ya existente) permite una excepción por persona; con
--                        los dos en NULL, vale la regla general.
--
-- ES SOLO ADITIVA. Se puede correr dos veces. Sin ella sigue funcionando el monto fijo por
-- trabajador y la configuración avisa que falta la migración.

CREATE TABLE IF NOT EXISTS worker_pay_config (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  mode TEXT NOT NULL DEFAULT 'fijo' CHECK (mode IN ('fijo', 'porcentaje')),
  value NUMERIC(12,2) CHECK (value IS NULL OR value >= 0),
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO worker_pay_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE workers ADD COLUMN IF NOT EXISTS pay_percent NUMERIC(5,2)
  CHECK (pay_percent IS NULL OR (pay_percent >= 0 AND pay_percent <= 100));

ALTER TABLE worker_pay_config ENABLE ROW LEVEL SECURITY;
