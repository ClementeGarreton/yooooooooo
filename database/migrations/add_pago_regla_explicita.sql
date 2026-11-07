-- Migration: «según su regla» explícito en el pago por trabajo
-- Date: 2026-10-23
-- Rama: fix/bugs-revision. Un trabajo de una empresa que se cierra por pallets (Monfiza) se
-- paga por pallets por defecto; elegir «Según su regla» borraba el ajuste y el trabajo volvía
-- solo a pallets. Ahora se guarda la elección: worker_job_pay.mode admite 'regla'.
--
-- ES ADITIVA (el CHECK solo se amplía). Se puede correr dos veces.

ALTER TABLE worker_job_pay DROP CONSTRAINT IF EXISTS worker_job_pay_mode_check;
ALTER TABLE worker_job_pay ADD CONSTRAINT worker_job_pay_mode_check CHECK (mode IN ('regla', 'fijo', 'pallets'));
