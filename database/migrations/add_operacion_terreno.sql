-- Migration: operación en terreno — inicio/fin de trabajo, N° de documento en gastos y
--            m³ y personal en las solicitudes de empresa
-- Date: 2026-10-09
-- Rama: feat/operacion-terreno.
--
-- QUÉ AGREGA
--   booking_work_logs               una fila por trabajador y trabajo: cuándo lo inició y
--                                   cuándo lo finalizó. `started_with_open` = lo inició con
--                                   otro trabajo sin finalizar (pasó la advertencia) y
--                                   `open_booking_id` dice cuál era.
--   documents.doc_number            N° de la boleta o factura de un gasto, para detectar
--                                   un mismo comprobante rendido dos veces.
--   service_requests.volume_m3      m³ que declara quien pide el servicio.
--   service_requests.people_needed  personas que pide.
--
-- ES SOLO ADITIVA. Se puede correr dos veces. Sin ella: los botones de iniciar/finalizar no
-- aparecen, los gastos se rinden sin número y las solicitudes se guardan sin esos dos datos.

CREATE TABLE IF NOT EXISTS booking_work_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  worker_id UUID NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  worker_label TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  started_with_open BOOLEAN NOT NULL DEFAULT FALSE,
  open_booking_id UUID,
  UNIQUE (booking_id, worker_id)
);

CREATE INDEX IF NOT EXISTS idx_booking_work_logs_open
  ON booking_work_logs (worker_id) WHERE finished_at IS NULL;

ALTER TABLE booking_work_logs ENABLE ROW LEVEL SECURITY;

ALTER TABLE documents ADD COLUMN IF NOT EXISTS doc_number TEXT;
CREATE INDEX IF NOT EXISTS idx_documents_doc_number
  ON documents (doc_number) WHERE kind = 'gasto' AND doc_number IS NOT NULL;

ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS volume_m3 NUMERIC(8,2)
  CHECK (volume_m3 IS NULL OR volume_m3 > 0);
ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS people_needed INTEGER
  CHECK (people_needed IS NULL OR people_needed > 0);
