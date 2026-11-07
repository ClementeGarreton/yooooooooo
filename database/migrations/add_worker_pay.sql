-- Migration: pago a trabajadores por trabajos realizados
-- Date: 2026-10-08
-- Rama: feat/contabilidad.
--
-- QUÉ AGREGA
--   workers.pay_per_job   lo que se le paga a ese trabajador por cada trabajo realizado
--                         (pesos). NULL = sin tarifa definida.
--   worker_payments       pagos hechos a un trabajador por los trabajos de un período:
--                         cuántos trabajos cubre, cuánto se pagó, cómo y quién lo registró.
--
-- ES SOLO ADITIVA. Se puede correr dos veces. Sin ella el panel muestra los trabajos
-- realizados por cada trabajador, pero no deja poner tarifas ni registrar pagos.
-- RLS activo y CERO policies, igual que el resto.

ALTER TABLE workers ADD COLUMN IF NOT EXISTS pay_per_job INTEGER
  CHECK (pay_per_job IS NULL OR pay_per_job >= 0);

CREATE TABLE IF NOT EXISTS worker_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id UUID NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  period_from DATE NOT NULL,
  period_to DATE NOT NULL,
  jobs INTEGER NOT NULL DEFAULT 0 CHECK (jobs >= 0),
  amount INTEGER NOT NULL CHECK (amount > 0),
  method TEXT,
  note TEXT,
  paid_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT,
  CHECK (period_from <= period_to)
);

CREATE INDEX IF NOT EXISTS worker_payments_worker_idx ON worker_payments (worker_id, period_from DESC);

ALTER TABLE worker_payments ENABLE ROW LEVEL SECURITY;
