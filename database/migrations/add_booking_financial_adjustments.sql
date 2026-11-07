-- Separa tres conceptos que antes convivían de forma ambigua en total_price:
--   original_price  = valor cotizado originalmente
--   adjusted_price  = valor final reajustado en terreno (NULL si no hubo reajuste)
--   amount_paid     = dinero efectivamente recibido hasta ahora

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS adjusted_price BIGINT,
  ADD COLUMN IF NOT EXISTS amount_paid BIGINT,
  ADD COLUMN IF NOT EXISTS adjustment_comment TEXT,
  ADD COLUMN IF NOT EXISTS adjusted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS adjusted_by TEXT;

-- Backfill conservador para datos históricos:
-- - cuando total_price difiere de original_price, la UI histórica lo interpretaba como
--   monto efectivamente pagado, por lo que se conserva tal cual;
-- - en registros nuevos donde ambos campos son iguales, se reconstruye el cobro con la
--   regla verificada contra Flow (50% para mitad, 95% para completo).
UPDATE bookings
SET amount_paid = CASE
  WHEN payment_status IS DISTINCT FROM 'approved' THEN 0
  WHEN original_price IS NOT NULL
       AND total_price IS NOT NULL
       AND total_price <> original_price THEN GREATEST(0, total_price::BIGINT)
  WHEN payment_type = 'mitad' THEN
    ROUND(COALESCE(original_price, total_price, 0)::NUMERIC * 0.50)::BIGINT
  WHEN payment_type = 'completo' THEN
    ROUND(COALESCE(original_price, total_price, 0)::NUMERIC * 0.95)::BIGINT
  ELSE GREATEST(0, COALESCE(total_price, original_price, 0)::BIGINT)
END
WHERE amount_paid IS NULL;

ALTER TABLE bookings
  ALTER COLUMN amount_paid SET DEFAULT 0,
  ALTER COLUMN amount_paid SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'bookings_adjusted_price_positive'
      AND conrelid = 'bookings'::regclass
  ) THEN
    ALTER TABLE bookings
      ADD CONSTRAINT bookings_adjusted_price_positive
      CHECK (adjusted_price IS NULL OR adjusted_price > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'bookings_amount_paid_nonnegative'
      AND conrelid = 'bookings'::regclass
  ) THEN
    ALTER TABLE bookings
      ADD CONSTRAINT bookings_amount_paid_nonnegative
      CHECK (amount_paid >= 0);
  END IF;
END $$;

COMMENT ON COLUMN bookings.adjusted_price IS
  'Precio final del servicio después de un reajuste en terreno. NULL = usar el precio cotizado.';
COMMENT ON COLUMN bookings.amount_paid IS
  'Monto acumulado efectivamente recibido. No se deriva del tipo de pago cuando este valor está informado.';
COMMENT ON COLUMN bookings.adjustment_comment IS
  'Motivo operativo del último reajuste financiero.';
COMMENT ON COLUMN bookings.adjusted_by IS
  'Usuario administrador que registró el último reajuste.';
