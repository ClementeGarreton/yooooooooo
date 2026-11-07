-- Migration: tareas por camión o por trabajador (panel Trabajos)
-- Date: 2026-10-20
-- Rama: feat/tareas-trabajos. Pedido de Francisco: «poder agregar trabajos nuevos al panel
-- trabajos de cosas por hacer en un camión o por trabajador, casi como notas».
--
-- QUÉ AGREGA
--   job_tasks   cosas por hacer que no son una reserva (llevar el camión a revisión, retirar
--               materiales…), para un camión (vehicle_id, el de Flota) o para un trabajador.
--               El trabajador las ve en /trabajos («Por hacer») —las suyas y las de su camión
--               habitual— y las marca hechas.
--
-- ES SOLO ADITIVA. Se puede correr dos veces. Sin ella la pestaña Tareas avisa que falta.

CREATE TABLE IF NOT EXISTS job_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  notes TEXT,
  due_date DATE,
  vehicle_id INTEGER,
  worker_id UUID REFERENCES workers(id) ON DELETE CASCADE,
  done_at TIMESTAMPTZ,
  done_by TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (vehicle_id IS NOT NULL OR worker_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS job_tasks_open_idx ON job_tasks (done_at, due_date);
CREATE INDEX IF NOT EXISTS job_tasks_worker_idx ON job_tasks (worker_id);

ALTER TABLE job_tasks ENABLE ROW LEVEL SECURITY;
