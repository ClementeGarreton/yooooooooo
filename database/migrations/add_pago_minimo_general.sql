-- Migration: mínimo por trabajo para todos en el pago por m³
-- Date: 2026-10-20
-- Rama: feat/pago-trabajadores-desglose. Pedido de Tomás: «un monto base al pago por metro
-- cúbico para todos, porque hay veces que es menos de un metro cúbico y no calcula nada».
--
-- QUÉ AGREGA
--   worker_pay_config.min_job   mínimo por trabajo en el pago por m³ para todos: si los m³
--                               dan menos (o el trabajo no tiene m³), se paga el mínimo. El
--                               mínimo propio de un trabajador (workers.pay_min_job) manda
--                               sobre este. NULL = sin mínimo general.
--
-- ES SOLO ADITIVA. Se puede correr dos veces. Sin ella todo sigue igual.

ALTER TABLE worker_pay_config ADD COLUMN IF NOT EXISTS min_job INTEGER
  CHECK (min_job IS NULL OR min_job > 0);
