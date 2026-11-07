-- Migration: Panel de perfiles — modificaciones en terreno (etapa 2, paso 6 / Módulo 4)
-- Date: 2026-10-03
-- Rama: feat/perfil-del-cliente.
--
-- QUÉ AGREGA
--   booking_modifications -> la diferencia que un trabajador registra en terreno contra lo
--                            cotizado (4 bultos declarados, 5 encontrados). Queda PENDIENTE
--                            hasta que la administración la aprueba (fijando el ajuste de
--                            precio, que puede ser $0) o la rechaza.
--
-- Cada fila es un hecho que no se edita: guarda el dato original, lo encontrado, quién lo
-- registró y cuándo, quién lo resolvió y cuándo, y el precio de la reserva antes y después.
-- La reserva conserva su `original_price`; el ajuste aprobado va a `adjusted_price`, igual
-- que un reajuste hecho a mano desde el panel.
--
-- ES SOLO ADITIVA: no toca nada que use `main`. Se puede correr dos veces.
-- RLS activo y CERO policies, igual que el resto (ver enable_rls_all_tables.sql).

CREATE TABLE IF NOT EXISTS booking_modifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  -- Quién la registró. El nombre se guarda aparte para que el historial se lea aunque el
  -- trabajador se borre.
  worker_id UUID REFERENCES workers(id) ON DELETE SET NULL,
  worker_label TEXT NOT NULL,
  -- Qué dato cambió.
  field TEXT NOT NULL CHECK (field IN ('bultos', 'volumen', 'horas', 'paradas', 'otro')),
  original_value TEXT NOT NULL,
  found_value TEXT NOT NULL,
  note TEXT NOT NULL,
  -- pendiente -> aprobada | rechazada.
  status TEXT NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente', 'aprobada', 'rechazada')),
  -- Al aprobar: ajuste de precio que fijó la administración (puede ser 0 o negativo) y el
  -- precio del servicio antes y después.
  price_delta INTEGER,
  price_before INTEGER,
  price_after INTEGER,
  resolved_by TEXT,
  resolved_at TIMESTAMPTZ,
  resolution_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE booking_modifications IS
  'Diferencias registradas en terreno contra lo cotizado, con su aprobación. Historial auditable: no se editan.';

CREATE INDEX IF NOT EXISTS booking_modifications_status_idx ON booking_modifications (status, created_at DESC);
CREATE INDEX IF NOT EXISTS booking_modifications_booking_idx ON booking_modifications (booking_id, created_at);
CREATE INDEX IF NOT EXISTS booking_modifications_worker_idx ON booking_modifications (worker_id, created_at DESC);

ALTER TABLE booking_modifications ENABLE ROW LEVEL SECURITY;
