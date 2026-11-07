-- Migration: cierre de pagos a funcionarios y forma de pago de los gastos
-- Date: 2026-10-12
-- Rama: feat/cierre-pagos.
--
-- QUÉ AGREGA
--   documents.expense_payment        cómo se pagó un gasto rendido: 'contado' (lo pagó el
--                                    funcionario de su bolsillo: hay que devolvérselo) o
--                                    'credito' (se pagó con medios de la empresa: no se le
--                                    debe nada). NULL en los gastos anteriores = contado.
--   documents.expense_reimbursed_at  cuándo se le devolvió la plata (NULL = pendiente)
--   documents.expense_reimbursed_by  quién lo marcó
--   documents.expense_closing_id     el cierre que lo dejó pagado, si fue por un cierre
--   worker_bonuses.amount            ahora acepta montos negativos (un descuento o ajuste en
--                                    contra): se reemplaza el CHECK «> 0» por «<> 0». Los
--                                    valores existentes siguen siendo válidos.
--   worker_pay_closings              cierre de un período para un funcionario: totales, glosa
--                                    y una copia del detalle tal como quedó al cerrar. Un
--                                    cierre reabierto conserva quién lo reabrió y cuándo.
--
-- No borra ni modifica datos. Se puede correr dos veces. Sin ella el pago a trabajadores
-- sigue como hoy y el panel de cierre avisa que falta.

ALTER TABLE documents ADD COLUMN IF NOT EXISTS expense_payment TEXT
  CHECK (expense_payment IS NULL OR expense_payment IN ('contado', 'credito'));
ALTER TABLE documents ADD COLUMN IF NOT EXISTS expense_reimbursed_at TIMESTAMPTZ;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS expense_reimbursed_by TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS expense_closing_id UUID;

ALTER TABLE worker_bonuses DROP CONSTRAINT IF EXISTS worker_bonuses_amount_check;
ALTER TABLE worker_bonuses ADD CONSTRAINT worker_bonuses_amount_check CHECK (amount <> 0);

CREATE TABLE IF NOT EXISTS worker_pay_closings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id UUID NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  period_from DATE NOT NULL,
  period_to DATE NOT NULL,
  jobs_total INTEGER NOT NULL DEFAULT 0,
  expenses_total INTEGER NOT NULL DEFAULT 0,
  adjustments_total INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  closed_by TEXT,
  closed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reopened_by TEXT,
  reopened_at TIMESTAMPTZ,
  CHECK (period_from <= period_to)
);

CREATE INDEX IF NOT EXISTS worker_pay_closings_worker_idx
  ON worker_pay_closings (worker_id, period_from DESC) WHERE reopened_at IS NULL;

ALTER TABLE worker_pay_closings ENABLE ROW LEVEL SECURITY;
