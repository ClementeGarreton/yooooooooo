-- Solicitudes de atención humana: no requieren correo ni cotización terminada.
CREATE TABLE IF NOT EXISTS handoff_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'whatsapp',
  quote_session_id UUID,
  quote_id TEXT,
  customer_name TEXT,
  customer_email TEXT,
  reason TEXT,
  details TEXT,
  quote_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready', 'attended')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS handoff_requests_pending_idx ON handoff_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS handoff_requests_phone_idx ON handoff_requests(phone, created_at DESC);
ALTER TABLE handoff_requests ENABLE ROW LEVEL SECURITY;
-- Se accede solamente desde servidor por service role; no crear políticas públicas.
