-- Migration: Panel de perfiles — cupones y referidos (etapa 2, paso 8 / Módulo 5)
-- Date: 2026-10-03
-- Rama: feat/perfil-del-cliente.
--
-- Decisiones de Francisco (03-10-2026): los cupones se usan SOLO en el panel del cliente
-- (al reservar una cotización); los referidos son un código por cliente que le da
-- descuento a quien llega y, cuando ese servicio se completa, un cupón de premio a quien
-- refirió. Los montos de referidos NO están definidos: se configuran en el admin y el
-- programa parte APAGADO.
--
-- QUÉ AGREGA
--   coupons            -> un código de descuento. Tres orígenes:
--                           manual   = lo crea el admin (campañas).
--                           referido = el código personal de un cliente (owner_customer_id);
--                                      su descuento sale de marketing_config, no de la fila.
--                           premio   = lo que gana quien refirió; solo lo usa su dueño, una vez.
--   coupon_redemptions -> cada uso de un cupón en una cotización, con el precio antes y
--                         después. Un uso «cuenta» cuando su reserva es real (pagada).
--   marketing_config   -> una sola fila: si los referidos están activos y cuánto dan.
--
-- ES SOLO ADITIVA: no toca nada que use `main`. Se puede correr dos veces.
-- RLS activo y CERO policies, igual que el resto (ver enable_rls_all_tables.sql).

CREATE TABLE IF NOT EXISTS coupons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Siempre en mayúsculas, letras y números.
  code TEXT UNIQUE NOT NULL,
  origin TEXT NOT NULL DEFAULT 'manual' CHECK (origin IN ('manual', 'referido', 'premio')),
  -- porcentaje (value = 1..100) o monto (value = pesos). NULL en los de origen 'referido'.
  kind TEXT CHECK (kind IN ('porcentaje', 'monto')),
  value INTEGER CHECK (value IS NULL OR value > 0),
  -- Precio mínimo de la cotización para poder usarlo. 0 = sin mínimo.
  min_amount INTEGER NOT NULL DEFAULT 0,
  -- Usos totales permitidos. NULL = sin tope.
  max_uses INTEGER CHECK (max_uses IS NULL OR max_uses > 0),
  valid_from DATE,
  valid_until DATE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  description TEXT,
  -- referido: de quién es el código. premio: quién puede usarlo.
  owner_customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE coupons IS
  'Cupones de descuento del panel del cliente: manuales (admin), códigos de referido y premios por referir.';

CREATE INDEX IF NOT EXISTS coupons_owner_idx ON coupons (owner_customer_id, origin);
-- Un solo código de referido por cliente.
CREATE UNIQUE INDEX IF NOT EXISTS coupons_one_referral_per_customer
  ON coupons (owner_customer_id) WHERE origin = 'referido';

CREATE TABLE IF NOT EXISTS coupon_redemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id UUID NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  -- La cotización donde se usó (quote_prospects.quote_id = bookings.quote_id).
  quote_id TEXT NOT NULL,
  booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
  amount_before INTEGER NOT NULL,
  discount INTEGER NOT NULL,
  amount_after INTEGER NOT NULL,
  -- Solo en usos de un código de referido: el cupón de premio que ya se le dio al dueño.
  reward_coupon_id UUID REFERENCES coupons(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Una cotización lleva a lo más un cupón.
  UNIQUE (quote_id)
);

CREATE INDEX IF NOT EXISTS coupon_redemptions_coupon_idx ON coupon_redemptions (coupon_id);
CREATE INDEX IF NOT EXISTS coupon_redemptions_customer_idx ON coupon_redemptions (customer_id);
CREATE INDEX IF NOT EXISTS coupon_redemptions_booking_idx ON coupon_redemptions (booking_id);

CREATE TABLE IF NOT EXISTS marketing_config (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  -- Apagado hasta que Tomás defina los montos.
  referral_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  -- Lo que recibe quien llega referido, en su primer servicio.
  referred_kind TEXT CHECK (referred_kind IN ('porcentaje', 'monto')),
  referred_value INTEGER CHECK (referred_value IS NULL OR referred_value > 0),
  -- Lo que recibe quien refirió, como cupón, cuando ese servicio se completa.
  reward_kind TEXT CHECK (reward_kind IN ('porcentaje', 'monto')),
  reward_value INTEGER CHECK (reward_value IS NULL OR reward_value > 0),
  -- Días que dura el cupón de premio desde que se entrega.
  reward_valid_days INTEGER NOT NULL DEFAULT 180 CHECK (reward_valid_days > 0),
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO marketing_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE coupons ENABLE ROW LEVEL SECURITY;
ALTER TABLE coupon_redemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_config ENABLE ROW LEVEL SECURITY;
