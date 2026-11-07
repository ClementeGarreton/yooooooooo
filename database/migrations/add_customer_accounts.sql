-- Migration: cuentas de cliente con clave (rediseño del admin, fase 3)
-- Date: 2026-10-03
-- Rama: feat/admin-rediseno.
--
-- Decisión de Francisco (03-10-2026): el cliente entra con correo + RUT SOLO LA PRIMERA
-- VEZ y ahí crea su clave. El link al correo sigue existiendo para quien no tiene RUT y
-- para recuperar la clave.
--
-- QUÉ AGREGA a `customers`
--   rut             -> RUT de la persona, CONFIRMADO por el equipo (lo carga o lo confirma
--                      alguien del panel). Es el único RUT que sirve para entrar la
--                      primera vez.
--   rut_declared    -> RUT que la persona escribió en el cotizador web. NO sirve para
--                      entrar: cualquiera puede cotizar con el correo de otra persona y
--                      un RUT propio. Queda a la vista en la ficha para confirmarlo.
--   password_hash   -> pbkdf2$<iteraciones>$<salt>$<hash> (src/lib/passwordHash.ts).
--                      NULL = todavía no creó su clave.
--   password_set_at -> cuándo la creó o la cambió por última vez.
--
-- Todos normalizados sin puntos y con guion (12345678-9). El RUT no es único: una misma
-- persona puede tener dos fichas con correos distintos.
--
-- ES SOLO ADITIVA: no toca nada que use `main`. Se puede correr dos veces.

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS rut TEXT,
  ADD COLUMN IF NOT EXISTS rut_declared TEXT,
  ADD COLUMN IF NOT EXISTS password_hash TEXT,
  ADD COLUMN IF NOT EXISTS password_set_at TIMESTAMPTZ;

COMMENT ON COLUMN customers.rut IS
  'RUT confirmado por el equipo. Con correo + este RUT el cliente entra la primera vez y crea su clave.';
COMMENT ON COLUMN customers.rut_declared IS
  'RUT escrito por la persona en el cotizador. No sirve para entrar hasta que el equipo lo confirma.';
