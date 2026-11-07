-- MVP 1.3: sesiones de cotización omnicanal + auditoría de conversaciones IA
-- Aplicar en Supabase antes de activar WhatsApp Cloud API.
--
-- ⚠️ CORRECCIÓN respecto del archivo original (revisado 2026-09-12):
-- El bloque final reescribía el CHECK de `quote_prospects.source` con solo 6 valores
-- y dejaba fuera TRES que el sistema ya usa: 'rrss', 'recomendacion' y
-- 'cliente_antiguo'. Medido contra producción ese día: 27 filas con
-- 'cliente_antiguo' y 1 con 'recomendacion' = 28 filas que el CHECK nuevo rechazaba.
-- Acá se listan los 8 vigentes + 'whatsapp'. Lo demás quedó igual.

CREATE TABLE IF NOT EXISTS quote_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resume_token TEXT NOT NULL UNIQUE,
  channel TEXT NOT NULL DEFAULT 'web' CHECK (channel IN ('web', 'whatsapp')),
  phone TEXT,
  status TEXT NOT NULL DEFAULT 'collecting' CHECK (status IN ('collecting', 'ready', 'quoted', 'handoff', 'closed')),
  current_section INTEGER NOT NULL DEFAULT 1 CHECK (current_section BETWEEN 1 AND 7),
  state JSONB NOT NULL DEFAULT '{}'::jsonb,
  quote_id TEXT,
  prospect_id UUID,
  estimated_price INTEGER,
  total_volume NUMERIC(10,2),
  total_weight NUMERIC(10,2),
  total_distance NUMERIC(10,2),
  recommended_vehicle TEXT,
  pdf_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quote_sessions_phone ON quote_sessions(phone);
CREATE INDEX IF NOT EXISTS idx_quote_sessions_status ON quote_sessions(status);
CREATE INDEX IF NOT EXISTS idx_quote_sessions_updated_at ON quote_sessions(updated_at DESC);

CREATE TABLE IF NOT EXISTS ai_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel TEXT NOT NULL CHECK (channel IN ('web', 'whatsapp')),
  external_user_id TEXT,
  customer_name TEXT,
  quote_session_id UUID REFERENCES quote_sessions(id) ON DELETE SET NULL,
  quote_id TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'quoted', 'handoff', 'closed', 'error')),
  converted BOOLEAN NOT NULL DEFAULT FALSE,
  input_tokens BIGINT NOT NULL DEFAULT 0,
  output_tokens BIGINT NOT NULL DEFAULT 0,
  estimated_ai_cost_usd NUMERIC(12,6) NOT NULL DEFAULT 0,
  model TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_conversations_channel ON ai_conversations(channel);
CREATE INDEX IF NOT EXISTS idx_ai_conversations_status ON ai_conversations(status);
CREATE INDEX IF NOT EXISTS idx_ai_conversations_last_message ON ai_conversations(last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_conversations_external_user ON ai_conversations(external_user_id);

CREATE TABLE IF NOT EXISTS ai_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL DEFAULT '',
  message_type TEXT NOT NULL DEFAULT 'text' CHECK (message_type IN ('text', 'image', 'document', 'interactive', 'system')),
  external_message_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_messages_external_message_id
  ON ai_messages(external_message_id)
  WHERE external_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_messages_conversation_created
  ON ai_messages(conversation_id, created_at ASC);

CREATE TABLE IF NOT EXISTS ai_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  structured_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  success BOOLEAN NOT NULL DEFAULT TRUE,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_actions_conversation_created
  ON ai_actions(conversation_id, created_at ASC);

-- Estas tablas sólo se consumen desde el backend con service_role y desde APIs admin autenticadas.
-- OJO: se habilita RLS sin crear políticas. Es correcto para tablas de backend
-- (service_role las salta), pero significa que con la anon key no se ve NADA.
ALTER TABLE quote_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_actions ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- El lead generado por WhatsApp usa el mismo CRM de prospectos.
--
-- ⚠️ ESTE ES EL ÚNICO BLOQUE QUE TOCA UNA TABLA EXISTENTE.
-- `quote_prospects` es la base del CRM: prospectos, fichas de cliente,
-- facturación por origen y el sistema de correos leen de ahí.
--
-- La lista tiene que incluir TODO lo que ya se usa. Los tres últimos los
-- agregaron `add_crm_origin_and_status.sql` (rrss, recomendacion) y
-- `add_legacy_customer_origin.sql` (cliente_antiguo); el panel los escribe desde
-- el selector "Origen del cliente". Sacarlos rompe ese selector.
-- ─────────────────────────────────────────────────────────────────────────────

-- Antes de tocar nada: si esto devuelve alguna fila, NO sigas — hay un valor de
-- `source` en uso que no está en la lista de abajo y hay que agregarlo primero.
SELECT source, COUNT(*) AS filas
FROM quote_prospects
WHERE source NOT IN (
  'web', 'pdf_download', 'email_quote', 'checkout_initiated', 'domicilio',
  'rrss', 'recomendacion', 'cliente_antiguo', 'whatsapp'
)
GROUP BY source;

ALTER TABLE quote_prospects DROP CONSTRAINT IF EXISTS quote_prospects_source_check;
ALTER TABLE quote_prospects
  ADD CONSTRAINT quote_prospects_source_check
  CHECK (source IN (
    'web',
    'pdf_download',
    'email_quote',
    'checkout_initiated',
    'domicilio',
    'rrss',              -- add_crm_origin_and_status.sql
    'recomendacion',     -- add_crm_origin_and_status.sql
    'cliente_antiguo',   -- add_legacy_customer_origin.sql — 27 filas en producción
    'whatsapp'           -- nuevo, para el chatbot
  ));

COMMENT ON COLUMN quote_prospects.source IS
  'Origen comercial: web (incluye origenes tecnicos del sitio), rrss, recomendacion, cliente_antiguo o whatsapp.';
