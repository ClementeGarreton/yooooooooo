-- Migration: Create email_log — libro mayor y candado de idempotencia del sistema de correos
-- Date: 2026-08-11
-- Description: Pieza central de la Fase 1 del sistema de email. Sin esta tabla no hay dedup,
--              ni tope de frecuencia, ni conteo mensual para el tramo del fee.
--
-- La tabla NO es una bandeja de salida: el cron (/api/cron/emails) deriva qué corresponde
-- enviar del estado actual de `bookings`, y usa esta tabla para saber qué ya se envió.
-- Ese orden importa: si fuera una cola pre-cargada haría falta un script de backfill para
-- las reservas impagas que ya existían, y ese script es justamente el que le mandaría
-- "falta tu pago" a gente cuya mudanza ya ocurrió.

CREATE TABLE IF NOT EXISTS email_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- QUÉ correo, con el paso incluido: '06_payment_due_2h' y '06_payment_due_24h' son
  -- tipos distintos porque cada uno se manda (o se salta) por separado.
  email_type    TEXT NOT NULL,

  -- A QUIÉN. SIEMPRE lower(trim()). La normalización la hace el helper y no la base:
  -- si acá llega un email sucio es un bug del llamador y queremos verlo, no taparlo.
  -- (En bookings hay direcciones en mayúsculas, p. ej. WALDO.VALDERRAMA@SFR.CL.)
  recipient     TEXT NOT NULL,

  -- SOBRE QUÉ. Acá vive la regla "dedup por persona, no por fila":
  --   'bk:<uuid>'      ciclo de UNA reserva          (#05 #06 #07 #08 #09 #10)
  --   'pe:<email>:<n>' ciclo de cotización de UNA persona (#01-#04) — por eso alguien
  --                    que re-cotiza continúa la secuencia en vez de empezarla de nuevo
  --   'mo:2026-08'     campaña mensual               (#campaña)
  scope_key     TEXT NOT NULL,

  -- Punteros para reportería y joins. NO son parte de la clave de idempotencia.
  prospect_id   UUID,
  booking_id    UUID,

  scheduled_for TIMESTAMPTZ NOT NULL,   -- cuándo se volvió exigible este correo
  sent_at       TIMESTAMPTZ,

  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  -- converted | superseded | freq_cap | min_gap | stale | precheck
  skip_reason   TEXT,
  error         TEXT,
  attempts      SMALLINT NOT NULL DEFAULT 0,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- LA clave de idempotencia. Las tres columnas son NOT NULL a propósito: en Postgres
  -- los NULL son distintos entre sí, así que una clave que admitiera NULL (por ejemplo
  -- sobre booking_id/prospect_id, que sí son nulables) no dedup-earía absolutamente nada.
  CONSTRAINT email_log_idem UNIQUE (email_type, recipient, scope_key)
);

-- Barrido del cron: filas reintentables y filas colgadas en 'pending'.
CREATE INDEX IF NOT EXISTS idx_email_log_due       ON email_log (status, scheduled_for);
-- Tope de frecuencia y gap mínimo: "¿cuántos correos recibió esta persona últimamente?".
CREATE INDEX IF NOT EXISTS idx_email_log_recipient ON email_log (recipient, sent_at DESC);
-- Historial de correos de una reserva (panel de Fase 6).
CREATE INDEX IF NOT EXISTS idx_email_log_booking   ON email_log (booking_id) WHERE booking_id IS NOT NULL;
-- Contador mensual que define el tramo del fee (panel de Fase 6).
CREATE INDEX IF NOT EXISTS idx_email_log_month     ON email_log (sent_at) WHERE status = 'sent';

COMMENT ON TABLE email_log IS
  'Un registro por correo decidido (enviado, saltado o fallido). Es el candado de idempotencia del cron de correos y la fuente del contador mensual que define el tramo del fee. No se edita a mano.';
COMMENT ON COLUMN email_log.email_type IS
  'Tipo + paso, p. ej. 06_payment_due_24h. Cada paso es un tipo distinto porque se decide por separado.';
COMMENT ON COLUMN email_log.recipient IS
  'Email normalizado a lower(trim()). Es la identidad de la PERSONA para dedup y tope de frecuencia.';
COMMENT ON COLUMN email_log.scope_key IS
  'Entidad sobre la que se dedup-ea: bk:<uuid> (reserva), pe:<email>:<n> (ciclo de cotización de una persona), mo:AAAA-MM (campaña).';
COMMENT ON COLUMN email_log.status IS
  'pending = reclamado pero sin resolución (si quedó así tras un timeout de n8n, es AMBIGUO: el correo pudo haberse enviado y NO se reintenta solo). sent | failed (reintentable) | skipped.';
COMMENT ON COLUMN email_log.skip_reason IS
  'Por qué no se envió: converted (la persona ya pagó/reservó), superseded (un paso posterior de la misma secuencia lo reemplazó), freq_cap, min_gap, stale, precheck.';
