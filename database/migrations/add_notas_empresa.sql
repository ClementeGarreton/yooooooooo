-- Migration: historial de notas de cada empresa
-- Date: 2026-10-27
-- Rama: feat/panel-empresa. Francisco (27-10-2026): la ficha de la empresa pasa a ser un
-- panel completo (trabajos por trabajador, facturas, cierres, documentos y notas). Las notas
-- son un historial «con fecha y autor» («27-10 Tomás: Philip autorizó doble cobro»).
--
-- QUÉ AGREGA
--   company_notes   una fila por nota: la empresa, el texto, quién la escribió (usuario del
--                   admin y su nombre a la vista) y cuándo. Solo se agregan: no se editan.
--
-- La columna vieja companies.notes (un solo texto) no se toca: si tiene algo, el panel lo
-- muestra aparte como «nota anterior».
--
-- ES ADITIVA. Se puede correr dos veces. Sin ella el panel funciona y la pestaña Notas avisa
-- que falta esta migración.

CREATE TABLE IF NOT EXISTS company_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  author TEXT,
  author_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS company_notes_company_idx ON company_notes (company_id, created_at DESC);

ALTER TABLE company_notes ENABLE ROW LEVEL SECURITY;
