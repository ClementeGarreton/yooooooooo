-- Migration: gastos de la empresa, para el panel de gastos y el estado de resultados
-- Date: 2026-10-10
-- Rama: feat/pago-m3-km.
--
-- QUÉ AGREGA
--   company_expenses   gastos de la empresa cargados a mano en Finanzas → Gastos: fecha,
--                      categoría, descripción, monto total, IVA incluido (si lo lleva),
--                      proveedor y N° de documento. Los gastos que rinden los trabajadores
--                      NO van acá: siguen en `documents` y el panel los muestra aparte.
--
-- ES SOLO ADITIVA. Se puede correr dos veces. Sin ella el estado de resultados se calcula
-- igual, sin la línea de gastos de la empresa, y el panel avisa que falta la migración.

CREATE TABLE IF NOT EXISTS company_expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_date DATE NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  iva INTEGER NOT NULL DEFAULT 0 CHECK (iva >= 0 AND iva <= amount),
  provider TEXT,
  doc_number TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS company_expenses_date_idx ON company_expenses (expense_date DESC);

ALTER TABLE company_expenses ENABLE ROW LEVEL SECURITY;
