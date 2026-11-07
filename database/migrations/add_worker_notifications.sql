-- Migration: avisos a los trabajadores (asignación de trabajos)
-- Date: 2026-10-04
-- Rama: feat/admin-rediseno.
--
-- QUÉ AGREGA
--   worker_notifications -> un aviso por trabajador y evento. Los escribe el panel cuando
--     a un trabajador le toca un trabajo (asignado a mano o por su camión habitual), se lo
--     quitan, se reprograma o se cancela. El trabajador los lee en /trabajos → «Avisos».
--     kind      assigned | removed | rescheduled | cancelled
--     read_at   NULL = sin leer (cuenta para el número de la pestaña)
--
-- ES SOLO ADITIVA: no toca nada que use `main`. Se puede correr dos veces.
-- Sin esta tabla el panel funciona igual: asignar no falla, solo no deja avisos.
-- RLS activo y CERO policies, igual que el resto (ver enable_rls_all_tables.sql).

CREATE TABLE IF NOT EXISTS worker_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id UUID NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('assigned', 'removed', 'rescheduled', 'cancelled')),
  title TEXT NOT NULL,
  body TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_worker_notifications_worker
  ON worker_notifications (worker_id, created_at DESC);

COMMENT ON TABLE worker_notifications IS
  'Avisos del panel a cada trabajador: trabajo asignado, quitado, reprogramado o cancelado.';

ALTER TABLE worker_notifications ENABLE ROW LEVEL SECURITY;
