-- Migration: asignar solas a la empresa las reservas de sus personas o con su RUT
-- Date: 2026-10-20
-- Rama: feat/empresa-auto-y-clientes-sin-montos. Pedido de Francisco: «auto asignar los
-- trabajos en panel empresa que tienen RUT empresa, como los de Martín Arteaga en Good Life».
--
-- QUÉ HACE
--   Una reserva queda asignada a una empresa (bookings.company_id) sin hacerlo a mano cuando:
--     1. el RUT de empresa de la reserva es el de una empresa del panel, o
--     2. el cliente de la reserva es una persona de esa empresa (customers.company_id).
--   - Al CREAR una reserva (y al cambiarle el RUT de empresa).
--   - Al asociar a una persona con una empresa: sus reservas sin empresa pasan a esa empresa.
--   - Una vez, ahora, con las reservas que ya existen (no canceladas y sin empresa).
--   Nunca cambia una reserva que ya tiene empresa, y quitarle la empresa a mano después no
--   la vuelve a asignar.
--
-- Cambia la regla anterior («asociar una persona NO mueve sus reservas»): desde ahora sí.
--
-- No crea columnas. Se puede correr dos veces.

-- RUT comparable: solo dígitos y K, sin ceros a la izquierda (76.595.546-7 = 76595546-7).
CREATE OR REPLACE FUNCTION rut_key(value TEXT) RETURNS TEXT AS $$
  SELECT NULLIF(ltrim(regexp_replace(upper(COALESCE(value, '')), '[^0-9K]', '', 'g'), '0'), '')
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION bookings_set_company() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.company_id IS NULL THEN
    IF rut_key(NEW.company_rut) IS NOT NULL THEN
      SELECT id INTO NEW.company_id FROM companies WHERE rut_key(rut) = rut_key(NEW.company_rut) LIMIT 1;
    END IF;
    IF NEW.company_id IS NULL AND NEW.customer_id IS NOT NULL THEN
      SELECT company_id INTO NEW.company_id FROM customers WHERE id = NEW.customer_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Corre DESPUÉS de bookings_customer_link (los BEFORE van por orden alfabético): así el
-- customer_id ya está resuelto.
DROP TRIGGER IF EXISTS bookings_link_company ON bookings;
CREATE TRIGGER bookings_link_company
  BEFORE INSERT OR UPDATE OF company_rut ON bookings
  FOR EACH ROW EXECUTE FUNCTION bookings_set_company();

-- Al asociar a una persona con una empresa, sus reservas sin empresa pasan a esa empresa.
CREATE OR REPLACE FUNCTION customers_assign_bookings() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.company_id IS NOT NULL AND NEW.company_id IS DISTINCT FROM OLD.company_id THEN
    UPDATE bookings
    SET company_id = NEW.company_id
    WHERE customer_id = NEW.id AND company_id IS NULL AND status <> 'cancelled';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS customers_company_bookings ON customers;
CREATE TRIGGER customers_company_bookings
  AFTER UPDATE OF company_id ON customers
  FOR EACH ROW EXECUTE FUNCTION customers_assign_bookings();

-- Una vez: las reservas que ya existen.
UPDATE bookings b
SET company_id = c.id
FROM companies c
WHERE b.company_id IS NULL
  AND b.status <> 'cancelled'
  AND rut_key(b.company_rut) IS NOT NULL
  AND rut_key(b.company_rut) = rut_key(c.rut);

UPDATE bookings b
SET company_id = cu.company_id
FROM customers cu
WHERE b.customer_id = cu.id
  AND cu.company_id IS NOT NULL
  AND b.company_id IS NULL
  AND b.status <> 'cancelled'
  AND COALESCE(b.quote_id, '') NOT LIKE 'ADMIN-BLOQUEO-%';
