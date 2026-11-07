-- Migration: libro de pagos por reserva
-- Date: 2026-09-02
-- Necesaria para el link de pago del saldo (punto 3 de la reunión del 1-sep).
--
-- POR QUÉ HACE FALTA
-- Hoy una reserva guarda UN pago: `flow_token`, `payment_status` y `amount_paid`. Con eso
-- alcanzaba mientras cada reserva se cobraba una sola vez. El link del saldo rompe ese
-- supuesto: la misma reserva pasa a tener dos cobros (el abono y el saldo).
--
-- Y `paymentSync` hoy solo escribe `amount_paid` cuando todavía está en cero:
--     if (!alreadyApproved && amount_paid <= 0) updateData.amount_paid = ...
-- O sea que un segundo pago aprobado NO se registraría. La plata entraría a Flow y el
-- sistema seguiría mostrando solo el abono — justo el problema que Tomás reportó en el
-- punto 8 con las reservas custom.
--
-- Sumar sin más tampoco sirve: Flow reintenta el webhook, y además `/api/payment/result`
-- aplica el mismo pago cuando el cliente vuelve por el navegador. Sin una clave de
-- idempotencia, el saldo se contaría dos o tres veces.
--
-- QUÉ HACE ESTA TABLA
-- Una fila por COBRO. `flow_token` es único: intentar registrar dos veces el mismo pago
-- no hace nada. Es el mismo patrón que ya usa `email_log` para no mandar el mismo correo
-- dos veces.
--
-- OJO: `bookings.amount_paid` SIGUE SIENDO la fuente de verdad de cuánto se cobró; todo
-- el sistema lee de ahí. Esta tabla es la clave de idempotencia y el detalle auditable
-- de cómo se llegó a ese número, no un reemplazo.

CREATE TABLE IF NOT EXISTS booking_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID REFERENCES bookings(id) ON DELETE CASCADE,
  -- quote_id se guarda además del booking_id porque es la referencia estable con la que
  -- Flow y el webhook resuelven la reserva.
  quote_id TEXT NOT NULL,
  -- Token de Flow. NULL para los cobros cargados a mano (transferencia, efectivo).
  flow_token TEXT,
  flow_order BIGINT,
  amount BIGINT NOT NULL CHECK (amount >= 0),
  -- 'abono'    -> el 50% inicial
  -- 'completo' -> pago total por adelantado (con el 5% de descuento)
  -- 'saldo'    -> lo que faltaba, cobrado después
  -- 'manual'   -> transferencia o efectivo cargado desde el panel
  -- 'historico'-> fila creada por el backfill de esta migración
  kind TEXT NOT NULL DEFAULT 'abono',
  status TEXT NOT NULL DEFAULT 'approved',
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- LA CLAVE DE IDEMPOTENCIA.
-- Parcial (WHERE flow_token IS NOT NULL) para que los cobros manuales, que no tienen
-- token, no choquen entre sí: en Postgres dos NULL no son iguales, pero un índice único
-- normal igual permitiría varios NULL — el parcial lo deja explícito.
CREATE UNIQUE INDEX IF NOT EXISTS booking_payments_flow_token_key
  ON booking_payments (flow_token) WHERE flow_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS booking_payments_booking_id_idx ON booking_payments (booking_id);
CREATE INDEX IF NOT EXISTS booking_payments_quote_id_idx   ON booking_payments (quote_id);

COMMENT ON TABLE booking_payments IS
  'Un cobro por fila. flow_token único = clave de idempotencia. bookings.amount_paid sigue siendo la fuente de verdad del total cobrado.';

-- Backfill: lo ya cobrado queda como una fila 'historico', para que el libro cuadre con
-- `amount_paid` desde el día uno. Se usa el flow_token de la reserva cuando lo hay; si
-- dos reservas compartieran token (no debería pasar), el índice único deja pasar una sola
-- y la otra queda sin token, que es el comportamiento correcto: no inventar idempotencia.
INSERT INTO booking_payments (booking_id, quote_id, flow_token, flow_order, amount, kind, status, paid_at, created_at)
SELECT
  b.id,
  b.quote_id,
  b.flow_token,
  b.flow_order,
  b.amount_paid,
  'historico',
  COALESCE(b.payment_status, 'approved'),
  b.payment_date,
  COALESCE(b.payment_date, b.created_at)
FROM bookings b
WHERE COALESCE(b.amount_paid, 0) > 0
  AND b.quote_id IS NOT NULL
  -- El NOT EXISTS es lo que hace re-ejecutable esta migración.
  -- `ON CONFLICT DO NOTHING` solo frena las filas CON token: las de cobros manuales
  -- tienen flow_token NULL, no chocan con nada, y en una segunda corrida se insertarían
  -- de nuevo. Verificado: sin esta línea, re-correr el backfill duplicaba esa fila.
  AND NOT EXISTS (
    SELECT 1 FROM booking_payments bp
    WHERE bp.booking_id = b.id AND bp.kind = 'historico'
  )
ON CONFLICT DO NOTHING;
