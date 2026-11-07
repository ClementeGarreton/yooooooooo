-- Migration: origen 'chat' para los prospectos que genera el chatbot web
-- Date: 2026-09-12
--
-- El chatbot registra sus cotizaciones como prospectos normales. Su canal de WhatsApp
-- ya quedó cubierto por `add_ai_conversations_and_quote_sessions.sql` (corrida el
-- 12-sep), que agregó 'whatsapp'; falta el canal web, que es 'chat'. Sin esto, un
-- INSERT con source='chat' falla con 23514.
--
-- ⚠️ LA LISTA TIENE QUE SER COMPLETA, NO INCREMENTAL.
-- `ADD CONSTRAINT` reemplaza, no suma. Omitir un valor en uso rompe el panel: ya pasó
-- una vez este mes, cuando una migración externa dejó fuera 'rrss', 'recomendacion' y
-- 'cliente_antiguo' — 28 filas la habrían violado. El historial vive repartido en
-- `create_quote_prospects_table.sql`, `add_crm_origin_and_status.sql`,
-- `add_legacy_customer_origin.sql` y `add_ai_conversations_and_quote_sessions.sql`.

-- Chequeo previo: si devuelve alguna fila, NO sigas — hay un origen en uso que falta
-- declarar abajo y el ADD CONSTRAINT va a fallar.
SELECT source, COUNT(*) AS filas
FROM quote_prospects
WHERE source NOT IN (
  'web', 'pdf_download', 'email_quote', 'checkout_initiated', 'domicilio',
  'rrss', 'recomendacion', 'cliente_antiguo', 'whatsapp', 'chat'
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
    'cliente_antiguo',   -- add_legacy_customer_origin.sql
    'whatsapp',          -- add_ai_conversations_and_quote_sessions.sql (chatbot, canal WhatsApp)
    'chat'               -- esta migración (chatbot, canal web)
  ));

COMMENT ON COLUMN quote_prospects.source IS
  'Origen comercial: web (incluye origenes tecnicos del sitio), rrss, recomendacion, cliente_antiguo, whatsapp o chat.';

-- NOTA SOBRE CÓMO SE VE EN EL PANEL
-- `normalizeOrigin()` (src/lib/prospectSource.ts) manda a "Web" todo lo que no sea
-- rrss / recomendacion / cliente_antiguo. Con esta migración, 'chat' y 'whatsapp' se
-- GUARDAN con su valor real pero se MUESTRAN como "Web", igual que 'pdf_download' o
-- 'domicilio'. Eso es deliberado: el dato queda en la base para analítica, y que el
-- chatbot aparezca como origen propio en el panel es una decisión comercial de Tomás,
-- no técnica. Si la quiere, hay que agregarlos a SOURCE_OPTIONS y a normalizeOrigin.
