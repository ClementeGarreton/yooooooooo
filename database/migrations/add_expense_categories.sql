-- Migration: categorías de gasto propias y categoría en los gastos de trabajadores
-- Date: 2026-10-12
-- Rama: feat/gastos-categorias.
--
-- QUÉ AGREGA
--   expense_categories            categorías de gasto creadas desde Finanzas → Gastos, además
--                                 de las que ya trae el panel. `active = false` la oculta de
--                                 la lista sin tocar los gastos que ya la usan.
--   documents.expense_category    categoría de un gasto rendido por un trabajador, para que
--                                 entre en el mismo desglose que los gastos de la empresa.
--
-- ES SOLO ADITIVA. Se puede correr dos veces. Sin ella siguen las categorías fijas y los
-- gastos de trabajadores aparecen «sin categoría».

CREATE TABLE IF NOT EXISTS expense_categories (
  slug TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE expense_categories ENABLE ROW LEVEL SECURITY;

ALTER TABLE documents ADD COLUMN IF NOT EXISTS expense_category TEXT;
