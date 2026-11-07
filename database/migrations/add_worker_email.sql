-- Migration: correo de los trabajadores y estado del aviso por correo
-- Date: 2026-10-04
-- Rama: feat/admin-rediseno.
--
-- QUÉ AGREGA
--   workers.email                       correo del trabajador (opcional). Si lo tiene, cada
--                                       aviso de `worker_notifications` también le llega por
--                                       correo, enviado directo con Resend (sin n8n).
--   worker_notifications.email_status   sent | failed | skipped:<motivo> | NULL (sin correo)
--   worker_notifications.email_error    el error de Resend, si falló
--   worker_notifications.emailed_at     cuándo salió
--
-- ES SOLO ADITIVA: no toca nada que use `main`. Se puede correr dos veces.
-- Sin esta migración todo funciona igual: los avisos quedan en el panel y no sale correo.

ALTER TABLE workers ADD COLUMN IF NOT EXISTS email TEXT;

ALTER TABLE worker_notifications ADD COLUMN IF NOT EXISTS email_status TEXT;
ALTER TABLE worker_notifications ADD COLUMN IF NOT EXISTS email_error TEXT;
ALTER TABLE worker_notifications ADD COLUMN IF NOT EXISTS emailed_at TIMESTAMPTZ;

COMMENT ON COLUMN workers.email IS 'Correo para los avisos de trabajos. Opcional.';
