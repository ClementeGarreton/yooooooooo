-- Migration: tipo de trabajador (terreno, contador, secretaria, externo)
-- Date: 2026-10-20
-- Rama: feat/tipos-trabajador. Pedido de Francisco: «poder agregar trabajadores pero no como
-- chofer sino como contador, secretaria, externo».
--
-- QUÉ AGREGA
--   workers.role   'terreno' (chofer o peoneta, como todos hasta hoy), 'contador',
--                  'secretaria' o 'externo'. Los que no son de terreno no tienen camión
--                  habitual ni aparecen al armar la cuadrilla de un trabajo; siguen en Pago a
--                  trabajadores, nómina y boletas.
--
-- ES ADITIVA. Se puede correr dos veces. Todos los trabajadores actuales quedan 'terreno'.

ALTER TABLE workers ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'terreno'
  CHECK (role IN ('terreno', 'contador', 'secretaria', 'externo'));
