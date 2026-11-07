-- Migration: detalle de cada pago a un funcionario y sueldo base
-- Date: 2026-10-13
-- Rama: feat/pago-por-trabajo.
--
-- QUÉ AGREGA
--   worker_payment_items          qué se pagó en cada pago registrado: cada trabajo, gasto,
--                                 ajuste o sueldo base, con su monto. La restricción única
--                                 (funcionario, tipo, referencia) impide pagar dos veces lo
--                                 mismo. Se borran con su pago.
--   workers.pay_base              sueldo base MENSUAL del funcionario, en pesos. NULL = no
--                                 tiene base (solo gana por trabajo).
--   documents.expense_payment_id  el pago que dejó reembolsado un gasto rendido.
--
-- ES SOLO ADITIVA. Se puede correr dos veces. Sin ella el pago a trabajadores sigue como
-- hoy (un monto por período, sin detalle) y el panel avisa que falta.

CREATE TABLE IF NOT EXISTS worker_payment_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID NOT NULL REFERENCES worker_payments(id) ON DELETE CASCADE,
  worker_id UUID NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('trabajo', 'gasto', 'ajuste', 'base')),
  ref TEXT NOT NULL,
  label TEXT,
  amount INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (worker_id, kind, ref)
);

CREATE INDEX IF NOT EXISTS worker_payment_items_payment_idx ON worker_payment_items (payment_id);

ALTER TABLE worker_payment_items ENABLE ROW LEVEL SECURITY;

ALTER TABLE workers ADD COLUMN IF NOT EXISTS pay_base INTEGER
  CHECK (pay_base IS NULL OR pay_base >= 0);

ALTER TABLE documents ADD COLUMN IF NOT EXISTS expense_payment_id UUID;
