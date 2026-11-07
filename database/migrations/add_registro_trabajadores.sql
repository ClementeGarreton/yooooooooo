-- Migration: registro de trabajadores por link y aprobación
-- Date: 2026-10-15
-- Rama: feat/registro-trabajadores.
--
-- QUÉ AGREGA
--   workers.approval_status        'pendiente' = se registró solo por el link y espera que la
--                                  oficina lo apruebe (no puede entrar); 'rechazado' = la
--                                  oficina no lo aprobó. NULL = trabajador normal (lo creó el
--                                  admin o ya se aprobó).
--   workers.signed_up_at           cuándo se registró por el link.
--   fleet_config.worker_signup_token / worker_signup_pin
--                                  el link de registro (uno solo para todos) y su clave, como
--                                  los links por camión. Sin token, el registro está cerrado.
--   fleet_config.worker_signup_require_pin
--                                  true = el link pide la clave; false = basta el link.
--
-- ES SOLO ADITIVA. Se puede correr dos veces. Sin ella el registro por link no está disponible
-- y Flota sigue como hoy. Los datos bancarios usan las columnas de
-- add_nomina_y_pago_por_trabajo.sql.

ALTER TABLE workers ADD COLUMN IF NOT EXISTS approval_status TEXT
  CHECK (approval_status IS NULL OR approval_status IN ('pendiente', 'rechazado'));
ALTER TABLE workers ADD COLUMN IF NOT EXISTS signed_up_at TIMESTAMPTZ;

ALTER TABLE fleet_config ADD COLUMN IF NOT EXISTS worker_signup_token TEXT;
ALTER TABLE fleet_config ADD COLUMN IF NOT EXISTS worker_signup_pin TEXT;
ALTER TABLE fleet_config ADD COLUMN IF NOT EXISTS worker_signup_require_pin BOOLEAN NOT NULL DEFAULT TRUE;
