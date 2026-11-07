-- Migration: créditos Yo me encargo por referidos, y su retiro
-- Date: 2026-10-04
-- Rama: feat/mejoras-tomas-oct.
--
-- Idea de Tomás (04-10-2026): el referido tiene dos pasos —(1) alguien usó el código para
-- cotizar, (2) pagó— y recién con los dos el dueño del código gana CRÉDITOS (1 crédito =
-- 1 CLP). El cliente puede retirarlos con un botón: tiene que haber cargado sus datos de
-- transferencia, y a Yo me encargo le llega un correo avisando.
--
-- QUÉ AGREGA
--   customer_credit_movements  libro de créditos: + por referido validado, − por retiro,
--                              + de vuelta si el retiro se rechaza. El saldo es la suma.
--                              `redemption_id` único: un uso de código da créditos una vez.
--   customer_bank_accounts     datos de transferencia del cliente (una fila por cliente).
--   credit_withdrawals         solicitudes de retiro, con la copia de los datos bancarios
--                              del momento. A lo más UNA «solicitado» por cliente.
--
-- ES SOLO ADITIVA. Se puede correr dos veces. Sin ella, los referidos siguen premiando con
-- cupón como hasta ahora. RLS activo y CERO policies, igual que el resto.

CREATE TABLE IF NOT EXISTS credit_withdrawals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL DEFAULT 'solicitado' CHECK (status IN ('solicitado', 'pagado', 'rechazado')),
  holder_name TEXT NOT NULL,
  holder_rut TEXT NOT NULL,
  bank_name TEXT NOT NULL,
  account_type TEXT NOT NULL,
  account_number TEXT NOT NULL,
  email TEXT,
  note TEXT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS credit_withdrawals_one_open
  ON credit_withdrawals (customer_id) WHERE status = 'solicitado';
CREATE INDEX IF NOT EXISTS credit_withdrawals_status_idx ON credit_withdrawals (status, requested_at DESC);

CREATE TABLE IF NOT EXISTS customer_credit_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  -- Positivo suma créditos, negativo los descuenta. 1 crédito = 1 CLP.
  amount INTEGER NOT NULL CHECK (amount <> 0),
  kind TEXT NOT NULL CHECK (kind IN ('referido', 'retiro', 'devolucion', 'ajuste')),
  redemption_id UUID UNIQUE REFERENCES coupon_redemptions(id) ON DELETE SET NULL,
  withdrawal_id UUID REFERENCES credit_withdrawals(id) ON DELETE SET NULL,
  note TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS customer_credit_movements_customer_idx
  ON customer_credit_movements (customer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS customer_bank_accounts (
  customer_id UUID PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
  holder_name TEXT NOT NULL,
  holder_rut TEXT NOT NULL,
  bank_name TEXT NOT NULL,
  account_type TEXT NOT NULL,
  account_number TEXT NOT NULL,
  email TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE credit_withdrawals ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_credit_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_bank_accounts ENABLE ROW LEVEL SECURITY;
