-- Migration: Panel de perfiles — solicitudes de servicio (etapa 2, paso 5 / Módulo 3)
-- Date: 2026-10-03
-- Rama: feat/perfil-del-cliente.
--
-- QUÉ AGREGA
--   service_requests -> lo que un cliente o una empresa PIDE desde su panel (mudanza,
--                       transporte o carga) antes de que exista una reserva. El equipo la
--                       cotiza y la aprueba desde el admin (pestaña «Por aprobar»), y al
--                       aprobarla se crea la reserva de siempre y queda enlazada acá.
--
-- La solicitud NUNCA se edita después de enviada: es lo que la persona pidió. La reserva
-- que nace de ella es la que se ajusta. Lo que pasa después (asignación, cierre) vive en
-- la reserva y en admin_activity_log, con fecha y usuario.
--
-- ES SOLO ADITIVA: no toca nada que use `main`. Se puede correr dos veces.
-- RLS activo y CERO policies, igual que el resto (ver enable_rls_all_tables.sql).

CREATE SEQUENCE IF NOT EXISTS service_request_code_seq;

CREATE TABLE IF NOT EXISTS service_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL DEFAULT 'SOL-' || LPAD(nextval('service_request_code_seq')::TEXT, 5, '0'),
  -- Quién la pidió y, si corresponde, para qué empresa.
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
  -- Qué pidió.
  service_type TEXT NOT NULL CHECK (service_type IN ('mudanza', 'transporte', 'carga')),
  origin_address TEXT NOT NULL,
  destination_address TEXT NOT NULL,
  requested_date DATE NOT NULL,
  requested_time TIME,
  contact TEXT,
  description TEXT NOT NULL,
  -- pendiente -> aprobada (tiene reserva) | rechazada (tiene motivo).
  status TEXT NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente', 'aprobada', 'rechazada')),
  resolved_by TEXT,
  resolved_at TIMESTAMPTZ,
  rejection_reason TEXT,
  booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE service_requests IS
  'Solicitudes de servicio enviadas desde el panel del cliente. Al aprobarlas nace una reserva (booking_id).';

CREATE INDEX IF NOT EXISTS service_requests_status_idx ON service_requests (status, created_at DESC);
CREATE INDEX IF NOT EXISTS service_requests_customer_idx ON service_requests (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS service_requests_company_idx ON service_requests (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS service_requests_booking_idx ON service_requests (booking_id);

ALTER TABLE service_requests ENABLE ROW LEVEL SECURITY;
