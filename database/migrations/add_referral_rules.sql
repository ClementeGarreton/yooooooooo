-- Migration: reglas de referidos como las de AppleFix (Ordenox), con 1 crédito = 1 CLP
-- Date: 2026-10-06
-- Rama: feat/referidos-como-applefix.
--
-- Se copia el modelo que ya funciona en AppleFix: cada cliente atendido tiene su código;
-- cuando un referido lo usa y PAGA, el dueño gana según lo que pagó el referido. La
-- diferencia: acá lo ganado son créditos que valen $1 cada uno y se retiran en plata, en vez
-- de tokens que se canjean por premios.
--
-- QUÉ AGREGA a `marketing_config`:
--   referred_cap      tope en pesos del descuento del referido (NULL = sin tope)
--   only_new          TRUE = el código solo sirve a quien nunca ha sido cliente
--   pesos_per_token   pesos pagados por el referido que le dan 1 crédito al dueño del código.
--                     Con 20, el dueño gana el 5 % de lo que pague el referido. NULL = se usa
--                     el «premio» anterior (monto fijo o porcentaje).
--
-- ES SOLO ADITIVA. Se puede correr dos veces. Sin ella el programa funciona con las reglas
-- anteriores y la configuración avisa al intentar guardar los campos nuevos.

ALTER TABLE marketing_config ADD COLUMN IF NOT EXISTS referred_cap INTEGER
  CHECK (referred_cap IS NULL OR referred_cap > 0);
ALTER TABLE marketing_config ADD COLUMN IF NOT EXISTS only_new BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE marketing_config ADD COLUMN IF NOT EXISTS pesos_per_token INTEGER
  CHECK (pesos_per_token IS NULL OR pesos_per_token > 0);
