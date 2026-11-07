-- Migration: Panel de perfiles — facturación mensual por empresa con Emisso (etapa 2, paso 7 / Módulo 6)
-- Date: 2026-10-03
-- Rama: feat/perfil-del-cliente.
--
-- QUÉ AGREGA
--   invoices         -> cada intento de factura 33 a una empresa por un mes: la vista previa
--                       del SII, la clave de idempotencia (se guarda ANTES de emitir), el
--                       resultado (folio, operación, XML firmado) o el error.
--   invoice_bookings -> qué reservas cubre cada factura y por cuánto. Es lo que impide
--                       facturar dos veces el mismo servicio.
--
-- Estados de `invoices.status`:
--   previsualizada -> el SII calculó los totales; todavía no se emitió nada.
--   emitiendo      -> se mandó a emitir y no hay respuesta guardada (corte a mitad de camino).
--   emitida        -> el SII confirmó: tiene folio.
--   rechazada      -> el SII la rechazó de forma concluyente: no existe.
--   fallida        -> falló ANTES de salir hacia el SII (vista previa vencida, falta un permiso): no existe.
--   desconocido    -> no se sabe si se emitió. NO se vuelve a previsualizar: se consulta la
--                     misma operación con la misma clave.
-- Bloquean una reserva: emitiendo, emitida y desconocido.
--
-- ES SOLO ADITIVA: no toca nada que use `main`. Se puede correr dos veces.
-- RLS activo y CERO policies, igual que el resto (ver enable_rls_all_tables.sql).

CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  -- Mes facturado, 'YYYY-MM'.
  period TEXT NOT NULL CHECK (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  tipo_dte TEXT NOT NULL DEFAULT '33',
  status TEXT NOT NULL DEFAULT 'previsualizada'
    CHECK (status IN ('previsualizada', 'emitiendo', 'emitida', 'rechazada', 'fallida', 'desconocido')),
  -- UUID v4 que identifica ESTE documento ante Emisso. Nunca se cambia para reintentar.
  idempotency_key UUID NOT NULL UNIQUE,
  preview_ref TEXT,
  preview_expires_at TIMESTAMPTZ,
  -- Lo que se mandó: receptor y líneas, tal cual. Montos de las líneas en NETO.
  receptor JSONB NOT NULL,
  detalles JSONB NOT NULL,
  -- Totales que calculó el SII en la vista previa.
  neto INTEGER,
  iva INTEGER,
  total INTEGER,
  -- Suma de los precios de las reservas en el panel (con IVA), para comparar con `total`.
  panel_total INTEGER NOT NULL,
  -- Resultado de la emisión.
  folio TEXT,
  operacion_id TEXT,
  fecha_emision DATE,
  confirmado_en TIMESTAMPTZ,
  xml_firmado TEXT,
  error_code TEXT,
  error_message TEXT,
  request_id TEXT,
  created_by TEXT,
  emitted_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE invoices IS
  'Facturas 33 mensuales por empresa, emitidas con Emisso. Una fila por intento; la clave de idempotencia no se reutiliza entre documentos.';

CREATE INDEX IF NOT EXISTS invoices_company_idx ON invoices (company_id, period DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS invoices_status_idx ON invoices (status);

CREATE TABLE IF NOT EXISTS invoice_bookings (
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
  -- Precio del servicio (con IVA) al momento de facturar.
  amount INTEGER NOT NULL,
  PRIMARY KEY (invoice_id, booking_id)
);

CREATE INDEX IF NOT EXISTS invoice_bookings_booking_idx ON invoice_bookings (booking_id);

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_bookings ENABLE ROW LEVEL SECURITY;
