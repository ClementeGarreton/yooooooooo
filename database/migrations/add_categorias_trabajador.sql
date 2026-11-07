-- Migration: categorías de trabajador (chofer, peoneta, administrativo)
-- Date: 2026-10-27
-- Rama: feat/pagos-trabajador. Tomás (27-10-2026): «categorizar los empleados […] como
-- administrativo, choferes y pionetas»: al sumar a la secretaria (y a Francisco) para pagarles,
-- empezaban a aparecer al programar los trabajos.
--
-- QUÉ CAMBIA
--   workers.role admite además 'chofer', 'peoneta' y 'administrativo'. Choferes y peonetas van
--   a terreno (camión habitual, cuadrillas); administrativo, contador y externo no.
--
-- No cambia a nadie: los que hoy están 'terreno' siguen apareciendo al programar y en
-- Flota → Trabajadores figuran «En terreno (falta categoría)» hasta que se les elija chofer o
-- peoneta. A la secretaria hay que ponerle «Administrativo» ahí mismo.
--
-- ES ADITIVA (el CHECK solo se amplía). Se puede correr dos veces. Requiere add_tipo_trabajador.sql.

ALTER TABLE workers DROP CONSTRAINT IF EXISTS workers_role_check;
ALTER TABLE workers ADD CONSTRAINT workers_role_check
  CHECK (role IN ('terreno', 'chofer', 'peoneta', 'administrativo', 'contador', 'secretaria', 'externo'));
