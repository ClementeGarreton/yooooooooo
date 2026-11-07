-- Migration: boleta de honorarios por funcionario
-- Date: 2026-10-20 (reemplaza la versión del 15-10, que no se alcanzó a correr)
-- Rama: release/pedidos-tomas.
--
-- QUÉ AGREGA
--   workers.issues_boleta                 true = el funcionario emite boleta de honorarios.
--   worker_pay_config.honorarios_rate     % de retención de la boleta. Tomás, 19-10-2026:
--                                         15,25 % en 2026 (16 % en 2027, 17 % en 2028), por eso
--                                         se cambia en Configuración.
--
-- CÓMO SE CALCULA (Tomás, 19-10-2026): con el funcionario se pacta el LÍQUIDO. La boleta se
-- hace por el bruto = líquido ÷ (1 − tasa) y la diferencia (la retención) la paga la empresa al
-- SII: es un costo adicional. Ej.: líquido $100.000 → boleta $117.994 → retención $17.994.
--
-- ES SOLO ADITIVA. Se puede correr dos veces. Sin ella el pago a trabajadores sigue como hoy,
-- sin retención.

ALTER TABLE workers ADD COLUMN IF NOT EXISTS issues_boleta BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE worker_pay_config ADD COLUMN IF NOT EXISTS honorarios_rate NUMERIC NOT NULL DEFAULT 15.25
  CHECK (honorarios_rate > 0 AND honorarios_rate < 100);
