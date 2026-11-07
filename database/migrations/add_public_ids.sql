-- Migration: IDs propios para cliente, reserva y cotización
-- Date: 2026-09-02
-- Pedido por Tomás/Francisco: "un id por cliente es clave cuando se manejan datos,
-- así como ID por reservas y cotizaciones, hace toda la analítica más fácil".
--
-- QUÉ RESUELVE
-- Hoy la identidad de un cliente ES SU EMAIL: para agrupar sus mudanzas hay que
-- comparar texto, con lo que eso implica (mayúsculas, espacios, PII en cada query).
-- Y ni las reservas ni las cotizaciones tienen un número que se pueda decir por
-- teléfono o pegar en una planilla: solo un UUID de 36 caracteres.
--
-- QUÉ AGREGA
--   customers                -> una fila por persona. id (UUID) + code (CL-000001).
--   bookings.code            -> RES-000001
--   bookings.customer_id     -> FK a customers
--   quote_prospects.code     -> COT-000001
--   quote_prospects.customer_id -> FK a customers
--
-- IMPORTANTE — `customers` NO reemplaza a `quote_prospects`.
-- La ficha editable del cliente (notas, origen, "cliente frecuente") sigue viviendo en
-- quote_prospects, que es lo que muestra el panel. `customers` es solo el ancla de
-- identidad para analítica: id estable, código legible y el email normalizado.
--
-- LOS CÓDIGOS Y EL customer_id LOS PONE LA BASE, NO LA APLICACIÓN.
-- Van por DEFAULT y por trigger a propósito: así una reserva creada desde cualquier
-- camino (web, panel, cron, un INSERT a mano en el SQL editor) queda igual de completa,
-- y desplegar la app antes o después de correr esto no rompe nada.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Tabla de clientes
-- ─────────────────────────────────────────────────────────────────────────────

CREATE SEQUENCE IF NOT EXISTS customer_code_seq;

CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL DEFAULT 'CL-' || LPAD(nextval('customer_code_seq')::TEXT, 6, '0'),
  -- Identidad. Siempre en minúsculas y sin espacios: lo garantiza el trigger.
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  phone TEXT,
  is_company BOOLEAN DEFAULT FALSE,
  company_name TEXT,
  company_rut TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE customers IS
  'Ancla de identidad por persona (email normalizado). La ficha comercial editable sigue en quote_prospects.';
COMMENT ON COLUMN customers.code IS 'Código legible: CL-000001. Estable, nunca se reusa.';

-- OJO CON LOS NÚMEROS: los códigos son únicos y estables, pero NO correlativos.
-- Un upsert sobre una fila que ya existe consume igual un número de la secuencia
-- (Postgres evalúa el DEFAULT antes de detectar el conflicto), así que van a quedar
-- huecos. Para contar clientes, reservas o cotizaciones se cuentan filas — nunca se
-- mira el código más alto.

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Códigos legibles en reservas y cotizaciones
-- ─────────────────────────────────────────────────────────────────────────────

CREATE SEQUENCE IF NOT EXISTS booking_code_seq;
CREATE SEQUENCE IF NOT EXISTS quote_code_seq;

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS code TEXT,
  ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id) ON DELETE SET NULL;

ALTER TABLE quote_prospects
  ADD COLUMN IF NOT EXISTS code TEXT,
  ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id) ON DELETE SET NULL;

COMMENT ON COLUMN bookings.code IS 'Código legible de la reserva: RES-000001.';
COMMENT ON COLUMN quote_prospects.code IS 'Código legible de la cotización: COT-000001.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Backfill del histórico
--
-- El orden importa: los códigos se asignan por created_at para que RES-000001 sea la
-- reserva más vieja y no la primera que toque el UPDATE. Si no, el número no diría nada.
-- ─────────────────────────────────────────────────────────────────────────────

-- 3a) Clientes, a partir de todos los emails que ya existen.
-- Se excluye el email de los bloqueos de agenda: son cupos reservados sin cliente, y
-- crearles una ficha ensuciaría el conteo de clientes.
INSERT INTO customers (email, name, phone, is_company, company_name, company_rut, created_at)
SELECT
  fuente.email,
  (ARRAY_AGG(fuente.name  ORDER BY fuente.created_at DESC) FILTER (WHERE NULLIF(TRIM(fuente.name), '')  IS NOT NULL))[1],
  (ARRAY_AGG(fuente.phone ORDER BY fuente.created_at DESC) FILTER (WHERE NULLIF(TRIM(fuente.phone), '') IS NOT NULL))[1],
  BOOL_OR(COALESCE(fuente.is_company, FALSE)),
  (ARRAY_AGG(fuente.company_name ORDER BY fuente.created_at DESC) FILTER (WHERE NULLIF(TRIM(fuente.company_name), '') IS NOT NULL))[1],
  (ARRAY_AGG(fuente.company_rut  ORDER BY fuente.created_at DESC) FILTER (WHERE NULLIF(TRIM(fuente.company_rut),  '') IS NOT NULL))[1],
  MIN(fuente.created_at)
FROM (
  SELECT LOWER(TRIM(client_email)) AS email, client_name AS name, client_phone AS phone,
         is_company, company_name, company_rut, created_at
  FROM bookings
  WHERE NULLIF(TRIM(client_email), '') IS NOT NULL
  UNION ALL
  SELECT LOWER(TRIM(email)) AS email, name, phone,
         is_company, company_name, company_rut, created_at
  FROM quote_prospects
  WHERE NULLIF(TRIM(email), '') IS NOT NULL
) AS fuente
WHERE fuente.email <> 'bloqueo+admin@example.com'
GROUP BY fuente.email
ON CONFLICT (email) DO NOTHING;

-- 3b) Códigos de las reservas, por antigüedad.
WITH numeradas AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC) AS n
  FROM bookings
  WHERE code IS NULL
)
UPDATE bookings b
SET code = 'RES-' || LPAD(numeradas.n::TEXT, 6, '0')
FROM numeradas
WHERE b.id = numeradas.id;

-- 3c) Códigos de las cotizaciones, por antigüedad.
WITH numeradas AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC) AS n
  FROM quote_prospects
  WHERE code IS NULL
)
UPDATE quote_prospects q
SET code = 'COT-' || LPAD(numeradas.n::TEXT, 6, '0')
FROM numeradas
WHERE q.id = numeradas.id;

-- 3d) Enlazar lo existente con su cliente.
UPDATE bookings b
SET customer_id = c.id
FROM customers c
WHERE b.customer_id IS NULL
  AND LOWER(TRIM(b.client_email)) = c.email;

UPDATE quote_prospects q
SET customer_id = c.id
FROM customers c
WHERE q.customer_id IS NULL
  AND LOWER(TRIM(q.email)) = c.email;

-- 3e) Las secuencias arrancan después del backfill, para no repetir códigos.
--
-- Se posicionan sobre el NÚMERO MÁS ALTO YA USADO, no sobre el conteo de filas, y nunca
-- por debajo de donde ya están. Con el conteo, correr esto una segunda vez después de
-- haber borrado alguna fila haría RETROCEDER la secuencia y el próximo código chocaría
-- con uno que ya existe. Esta migración se corre a mano, así que tiene que aguantar
-- que se corra dos veces.
SELECT setval('booking_code_seq', GREATEST(
  (SELECT COALESCE(MAX(NULLIF(REGEXP_REPLACE(code, '\D', '', 'g'), ''))::BIGINT, 0) FROM bookings),
  (SELECT last_value FROM booking_code_seq), 1));
SELECT setval('quote_code_seq', GREATEST(
  (SELECT COALESCE(MAX(NULLIF(REGEXP_REPLACE(code, '\D', '', 'g'), ''))::BIGINT, 0) FROM quote_prospects),
  (SELECT last_value FROM quote_code_seq), 1));
SELECT setval('customer_code_seq', GREATEST(
  (SELECT COALESCE(MAX(NULLIF(REGEXP_REPLACE(code, '\D', '', 'g'), ''))::BIGINT, 0) FROM customers),
  (SELECT last_value FROM customer_code_seq), 1));

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) Filas nuevas: código por DEFAULT y cliente por trigger
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE bookings
  ALTER COLUMN code SET DEFAULT 'RES-' || LPAD(nextval('booking_code_seq')::TEXT, 6, '0');
ALTER TABLE quote_prospects
  ALTER COLUMN code SET DEFAULT 'COT-' || LPAD(nextval('quote_code_seq')::TEXT, 6, '0');

-- Los UNIQUE se crean DESPUÉS del backfill: antes fallarían con los NULL repetidos.
CREATE UNIQUE INDEX IF NOT EXISTS bookings_code_key        ON bookings (code);
CREATE UNIQUE INDEX IF NOT EXISTS quote_prospects_code_key ON quote_prospects (code);

-- Índices para las consultas de analítica que motivaron todo esto.
CREATE INDEX IF NOT EXISTS bookings_customer_id_idx        ON bookings (customer_id);
CREATE INDEX IF NOT EXISTS quote_prospects_customer_id_idx ON quote_prospects (customer_id);

/*
 * Resuelve (o crea) el cliente de una fila y le pega el customer_id.
 *
 * Se hace en la base y no en la aplicación para que valga en TODOS los caminos que
 * escriben: el cotizador web, el panel, el cron y cualquier INSERT hecho a mano.
 *
 * Sobre los datos del cliente: solo se rellenan los que estén vacíos. Una reserva nueva
 * NO pisa el nombre ni el teléfono que ya tenía la ficha — si no, un typo en una reserva
 * renombraría al cliente para siempre.
 */
CREATE OR REPLACE FUNCTION resolve_customer_id(
  p_email TEXT, p_name TEXT, p_phone TEXT,
  p_is_company BOOLEAN, p_company_name TEXT, p_company_rut TEXT
) RETURNS UUID AS $$
DECLARE
  v_email TEXT;
  v_id UUID;
BEGIN
  v_email := LOWER(TRIM(COALESCE(p_email, '')));
  -- Sin email no hay identidad. Los bloqueos de agenda no son clientes.
  IF v_email = '' OR v_email = 'bloqueo+admin@example.com' THEN
    RETURN NULL;
  END IF;

  -- Se busca ANTES de intentar el INSERT a propósito.
  --
  -- Postgres evalúa el DEFAULT de `code` (o sea, nextval) ANTES de detectar el
  -- conflicto, así que un INSERT ... ON CONFLICT sobre un cliente que ya existe igual
  -- se come un número de la secuencia. Con 900+ cotizaciones, la mayoría de clientes
  -- que vuelven, los códigos se irían a las nubes sin que crezca la cartera.
  -- Buscando primero, el camino normal (cliente conocido) no toca la secuencia.
  SELECT id INTO v_id FROM customers WHERE email = v_email;

  IF v_id IS NOT NULL THEN
    UPDATE customers SET
      name         = COALESCE(name,         NULLIF(TRIM(COALESCE(p_name, '')), '')),
      phone        = COALESCE(phone,        NULLIF(TRIM(COALESCE(p_phone, '')), '')),
      company_name = COALESCE(company_name, NULLIF(TRIM(COALESCE(p_company_name, '')), '')),
      company_rut  = COALESCE(company_rut,  NULLIF(TRIM(COALESCE(p_company_rut, '')), '')),
      is_company   = is_company OR COALESCE(p_is_company, FALSE),
      updated_at   = NOW()
    WHERE id = v_id;
    RETURN v_id;
  END IF;

  -- Cliente nuevo. El ON CONFLICT queda igual por si dos inserciones simultáneas
  -- pasaron las dos por el SELECT de arriba; ahí sí se pierde un número, y es raro.
  INSERT INTO customers (email, name, phone, is_company, company_name, company_rut)
  VALUES (v_email, NULLIF(TRIM(COALESCE(p_name, '')), ''), NULLIF(TRIM(COALESCE(p_phone, '')), ''),
          COALESCE(p_is_company, FALSE), NULLIF(TRIM(COALESCE(p_company_name, '')), ''),
          NULLIF(TRIM(COALESCE(p_company_rut, '')), ''))
  ON CONFLICT (email) DO UPDATE SET
    name         = COALESCE(customers.name,         EXCLUDED.name),
    phone        = COALESCE(customers.phone,        EXCLUDED.phone),
    company_name = COALESCE(customers.company_name, EXCLUDED.company_name),
    company_rut  = COALESCE(customers.company_rut,  EXCLUDED.company_rut),
    is_company   = customers.is_company OR COALESCE(EXCLUDED.is_company, FALSE),
    updated_at   = NOW()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION bookings_set_customer() RETURNS TRIGGER AS $$
BEGIN
  NEW.customer_id := resolve_customer_id(
    NEW.client_email, NEW.client_name, NEW.client_phone,
    NEW.is_company, NEW.company_name, NEW.company_rut
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION quote_prospects_set_customer() RETURNS TRIGGER AS $$
BEGIN
  NEW.customer_id := resolve_customer_id(
    NEW.email, NEW.name, NEW.phone,
    NEW.is_company, NEW.company_name, NEW.company_rut
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS bookings_customer_link ON bookings;
CREATE TRIGGER bookings_customer_link
  BEFORE INSERT OR UPDATE OF client_email ON bookings
  FOR EACH ROW EXECUTE FUNCTION bookings_set_customer();

DROP TRIGGER IF EXISTS quote_prospects_customer_link ON quote_prospects;
CREATE TRIGGER quote_prospects_customer_link
  BEFORE INSERT OR UPDATE OF email ON quote_prospects
  FOR EACH ROW EXECUTE FUNCTION quote_prospects_set_customer();
