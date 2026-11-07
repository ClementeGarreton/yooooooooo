-- Migration: textos legales editables desde el panel
-- Date: 2026-10-09
-- Rama: feat/editar-empresa-y-politicas.
--
-- QUÉ AGREGA
--   legal_documents   el texto vigente de «Políticas de Garantía» y de «Términos y
--                     Condiciones» cuando se edita desde Configuración. Una fila por
--                     documento. Sin fila, la página muestra el texto que viene en el código.
--
-- ES SOLO ADITIVA. Se puede correr dos veces. Sin ella las dos páginas siguen exactamente
-- como hoy y Configuración avisa que falta la migración.

CREATE TABLE IF NOT EXISTS legal_documents (
  slug TEXT PRIMARY KEY CHECK (slug IN ('politicas-de-garantia', 'terminos-y-condiciones')),
  content TEXT NOT NULL CHECK (char_length(content) BETWEEN 1 AND 100000),
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE legal_documents ENABLE ROW LEVEL SECURITY;
