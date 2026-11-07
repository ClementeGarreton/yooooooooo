-- Migration: comentarios sobre un trabajador (ficha interna)
-- Date: 2026-10-05
-- Rama: feat/mejoras-tomas-oct.
--
-- Pedido de Tomás: poder anotar cosas en la ficha de cada trabajador («se entrega carta de
-- amonestación», «disponible de lunes a miércoles»). Es un historial: cada comentario queda
-- con fecha y con quién lo escribió. Solo lo ve el panel; el trabajador no.
--
-- ES SOLO ADITIVA. Se puede correr dos veces. RLS activo y CERO policies.

CREATE TABLE IF NOT EXISTS worker_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id UUID NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  comment TEXT NOT NULL CHECK (LENGTH(TRIM(comment)) > 0),
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS worker_comments_worker_idx ON worker_comments (worker_id, created_at DESC);

ALTER TABLE worker_comments ENABLE ROW LEVEL SECURITY;
