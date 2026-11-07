-- Migration: nómina para el banco y formas de cálculo del pago por trabajo
-- Date: 2026-10-15
-- Rama: feat/nomina-y-pago-por-trabajo.
--
-- QUÉ AGREGA
--   workers.bank_code                  código del banco de destino (el de la nómina del banco).
--   workers.bank_account_type          tipo de cuenta de destino: CCT (corriente) o CTV (vista),
--                                      los dos que trae la plantilla del banco.
--   workers.bank_account_number        número de cuenta, como texto (no pierde ceros a la izquierda).
--   workers.pay_min_job                mínimo por trabajo cuando se le paga por m³: si los m³ dan
--                                      menos, se le paga el mínimo. NULL = sin mínimo.
--   worker_pay_config.rate_pallet      pesos (líquidos) por pallet entregado.
--   worker_pay_config.max_pallets_per_address
--                                      máximo de pallets pagados por dirección de entrega.
--   worker_pay_config.origin_account_type / origin_account_number
--                                      la cuenta de la empresa desde la que sale la nómina.
--   bookings.outside_santiago          trabajo fuera de Santiago: solo entonces se suman los km
--                                      al pago por m³ y km.
--   bookings.pallets                   pallets entregados en el trabajo.
--   worker_job_pay                     lo que se le paga a UNA persona por UN trabajo cuando no
--                                      sale de su regla: un monto fijo escrito a mano, o por
--                                      pallets (pallets del trabajo × pesos por pallet).
--
-- ES SOLO ADITIVA. Se puede correr dos veces. Sin ella el pago a trabajadores sigue como hoy
-- (y los km se siguen sumando siempre) y el panel avisa que falta.
--
-- OJO: al correrla, todos los trabajos quedan «en Santiago». Desde ese momento los km solo
-- suman en los trabajos que se marquen «fuera de Santiago». Lo ya pagado no cambia: cada pago
-- guardó su monto.

ALTER TABLE workers ADD COLUMN IF NOT EXISTS bank_code INTEGER
  CHECK (bank_code IS NULL OR bank_code > 0);
ALTER TABLE workers ADD COLUMN IF NOT EXISTS bank_account_type TEXT
  CHECK (bank_account_type IS NULL OR bank_account_type IN ('CCT', 'CTV'));
ALTER TABLE workers ADD COLUMN IF NOT EXISTS bank_account_number TEXT;
ALTER TABLE workers ADD COLUMN IF NOT EXISTS pay_min_job INTEGER
  CHECK (pay_min_job IS NULL OR pay_min_job >= 0);

ALTER TABLE worker_pay_config ADD COLUMN IF NOT EXISTS rate_pallet NUMERIC
  CHECK (rate_pallet IS NULL OR rate_pallet >= 0);
ALTER TABLE worker_pay_config ADD COLUMN IF NOT EXISTS max_pallets_per_address INTEGER
  CHECK (max_pallets_per_address IS NULL OR max_pallets_per_address > 0);
ALTER TABLE worker_pay_config ADD COLUMN IF NOT EXISTS origin_account_type TEXT
  CHECK (origin_account_type IS NULL OR origin_account_type IN ('CCT', 'CTV'));
ALTER TABLE worker_pay_config ADD COLUMN IF NOT EXISTS origin_account_number TEXT;

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS outside_santiago BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS pallets INTEGER
  CHECK (pallets IS NULL OR pallets >= 0);

CREATE TABLE IF NOT EXISTS worker_job_pay (
  worker_id UUID NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('fijo', 'pallets')),
  -- Solo en 'fijo': el monto escrito a mano.
  amount INTEGER CHECK (amount IS NULL OR amount >= 0),
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (worker_id, booking_id)
);

CREATE INDEX IF NOT EXISTS worker_job_pay_booking_idx ON worker_job_pay (booking_id);

ALTER TABLE worker_job_pay ENABLE ROW LEVEL SECURITY;

-- Pago por pallet de Tomás (respuestas del 19-10-2026): $2.500 líquido por pallet, máximo 4
-- pallets pagados por dirección de entrega. Solo si todavía no hay valores.
UPDATE worker_pay_config SET rate_pallet = 2500 WHERE id = 1 AND rate_pallet IS NULL;
UPDATE worker_pay_config SET max_pallets_per_address = 4 WHERE id = 1 AND max_pallets_per_address IS NULL;
