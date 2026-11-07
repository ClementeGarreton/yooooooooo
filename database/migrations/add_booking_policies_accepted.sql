-- Migration: aceptación de las Políticas de Garantía al reservar
-- Date: 2026-09-30
-- Pedido de Francisco: guardar en la base que el cliente aceptó las políticas
-- (yomeencargo.cl/politicas-de-garantia) al reservar desde el cotizador web.
--
-- QUÉ GUARDA
-- La fecha y hora en que el cliente marcó la casilla, en la reserva. Se escribe en los dos
-- caminos para reservar de la web:
--   - pagar en la página (casilla «Estoy de acuerdo con las Políticas de Garantía»);
--   - pedir la cotización por correo y pagar desde el enlace (casilla «Acepto los Términos
--     y Condiciones, las Políticas de Garantía y la Política de Privacidad»).
-- Si el cliente la vuelve a marcar antes de pagar, queda la última vez. Una reserva ya
-- pagada no se toca.
--
-- NULL = no hay registro de aceptación: las reservas que ya existen, las creadas desde el
-- panel y las cotizaciones que el equipo envía desde el panel (esas no pasan por la casilla).
--
-- ES SEGURO CORRERLA ANTES O DESPUÉS DEL DEPLOY
-- Si la columna todavía no existe, la reserva y el pago funcionan igual; solo no se guarda
-- la hora (queda un aviso en el log). Se puede correr más de una vez.

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS policies_accepted_at timestamptz;

COMMENT ON COLUMN bookings.policies_accepted_at IS
  'Cuándo el cliente aceptó las Políticas de Garantía en el cotizador web. NULL = sin registro.';

-- Que la API (PostgREST) vea la columna nueva de inmediato.
NOTIFY pgrst, 'reload schema';
