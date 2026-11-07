-- Migration: aprobación de los gastos que rinden los trabajadores
-- Date: 2026-10-04
-- Rama: feat/mejoras-tomas-oct.
--
-- Los gastos son filas de `documents` con kind = 'gasto' (comprobante + nombre + monto).
-- QUÉ AGREGA a `documents`:
--   expense_status         pendiente | aprobado | rechazado. NULL en un gasto = pendiente
--                          (los que se subieron antes de esta migración).
--   expense_reviewed_by    usuario del panel que decidió
--   expense_reviewed_at    cuándo
--   expense_reject_reason  motivo del rechazo; lo lee el trabajador en su panel
--
-- ES SOLO ADITIVA. Se puede correr dos veces. Sin ella, los gastos se listan en el panel
-- pero aprobar o rechazar devuelve un aviso de que falta la migración.

ALTER TABLE documents ADD COLUMN IF NOT EXISTS expense_status TEXT
  CHECK (expense_status IS NULL OR expense_status IN ('pendiente', 'aprobado', 'rechazado'));
ALTER TABLE documents ADD COLUMN IF NOT EXISTS expense_reviewed_by TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS expense_reviewed_at TIMESTAMPTZ;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS expense_reject_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_documents_expenses
  ON documents (created_at DESC) WHERE kind = 'gasto';
