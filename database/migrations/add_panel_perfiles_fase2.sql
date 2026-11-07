-- Migration: Panel de perfiles — base de datos de la etapa 2
-- Date: 2026-10-01
-- Rama: feat/perfil-del-cliente. Propuesta aprobada por Tomás el 01-10-2026.
--
-- QUÉ AGREGA
--   companies          -> la empresa como entidad propia (razón social, RUT, datos de
--                         facturación). Es el ID al que se asocian todas las reservas y
--                         facturas de una empresa para facturarle mensual con Emisso.
--   customers.company_id / company_role
--                      -> un cliente sigue siendo una persona; se le puede ASOCIAR una
--                         empresa. 'encargado' ve todo lo de la empresa; 'miembro' ve
--                         solo lo suyo (decisión de Francisco, 01-10-2026).
--   workers            -> cada trabajador con su RUT y su PIN personal (hash PBKDF2, el
--                         mismo formato que admin_users). Reemplaza al PIN compartido.
--   booking_workers    -> qué trabajadores van a cada servicio (una mudanza lleva
--                         cuadrilla, no una persona).
--   documents          -> fotos y documentos que suben clientes, empresas y trabajadores
--                         (respaldo de modificaciones, gastos, documentos del servicio).
--   bucket 'documentos' -> PRIVADO. A diferencia de 'bookings' (público), acá van
--                         facturas, boletas de gastos y fotos de casas: se sirven solo con
--                         URL firmada y de corta duración, desde el servidor.
--
-- ES SOLO ADITIVA: no renombra, borra ni cambia nada que use `main`. Se puede correr
-- antes de fusionar la rama. Se puede correr dos veces sin romper nada.
--
-- RLS activo y CERO policies en todo, igual que el resto (ver enable_rls_all_tables.sql).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Empresas
-- ─────────────────────────────────────────────────────────────────────────────

CREATE SEQUENCE IF NOT EXISTS company_code_seq;

CREATE TABLE IF NOT EXISTS companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL DEFAULT 'EMP-' || LPAD(nextval('company_code_seq')::TEXT, 5, '0'),
  razon_social TEXT NOT NULL,
  -- Normalizado sin puntos y con guion (76452118-9). Único: una empresa, un RUT.
  rut TEXT UNIQUE NOT NULL,
  -- Datos que pide la factura 33 en Emisso. Los largos máximos son los del SII.
  giro TEXT,
  direccion TEXT,
  comuna TEXT,
  ciudad TEXT,
  -- Adónde mandar las facturas. Puede no ser el correo de ninguna persona asociada.
  email_facturacion TEXT,
  -- Factura mensual (la emite el admin con un clic) o por servicio.
  facturacion_mensual BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE companies IS
  'Empresa cliente: el ID que agrupa reservas y facturas para facturar mensual. Las personas son customers.';

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS company_role TEXT CHECK (company_role IN ('encargado', 'miembro'));

COMMENT ON COLUMN customers.company_role IS
  'encargado = ve todo lo de la empresa; miembro = ve solo lo suyo. NULL si no tiene empresa.';

CREATE INDEX IF NOT EXISTS customers_company_id_idx ON customers (company_id);

-- Las reservas también llevan la empresa: es lo que se factura en el mes. Se copia al
-- asociar, y no se deduce del cliente al facturar, porque una persona puede cambiar de
-- empresa y sus mudanzas viejas no se mueven con ella.
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS bookings_company_id_idx ON bookings (company_id, scheduled_date);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Trabajadores
-- ─────────────────────────────────────────────────────────────────────────────

CREATE SEQUENCE IF NOT EXISTS worker_code_seq;

CREATE TABLE IF NOT EXISTS workers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL DEFAULT 'TRB-' || LPAD(nextval('worker_code_seq')::TEXT, 4, '0'),
  name TEXT NOT NULL,
  -- Normalizado sin puntos y con guion. Es el usuario con el que entra.
  rut TEXT UNIQUE NOT NULL,
  phone TEXT,
  -- pbkdf2$<iteraciones>$<salt>$<hash> (src/lib/passwordHash.ts). Nunca el PIN en claro.
  pin_hash TEXT NOT NULL,
  -- Camión habitual (fleet_config). Informativo: lo que manda es booking_workers.
  vehicle_id INTEGER,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE workers IS 'Trabajadores con acceso individual (RUT + PIN personal) al panel del trabajador.';

CREATE TABLE IF NOT EXISTS booking_workers (
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  worker_id UUID NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  assigned_by TEXT,
  PRIMARY KEY (booking_id, worker_id)
);

CREATE INDEX IF NOT EXISTS booking_workers_worker_idx ON booking_workers (worker_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Documentos
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- A qué pertenece. Una reserva casi siempre; un documento de empresa puede no tenerla.
  booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
  -- Quién lo subió. uploaded_by_id apunta a customers, workers o admin_users según el tipo.
  uploaded_by_type TEXT NOT NULL CHECK (uploaded_by_type IN ('cliente', 'trabajador', 'admin')),
  uploaded_by_id TEXT,
  uploaded_by_label TEXT,
  -- foto = registro del servicio; gasto = respaldo de un gasto en terreno; documento = otro.
  kind TEXT NOT NULL DEFAULT 'documento' CHECK (kind IN ('foto', 'documento', 'gasto')),
  -- Ruta dentro del bucket privado 'documentos'. Nunca una URL pública.
  storage_path TEXT NOT NULL,
  file_name TEXT,
  mime_type TEXT,
  size_bytes INTEGER,
  note TEXT,
  -- Solo para gastos: monto del respaldo. Si se aprueba o no, lo define el Módulo 4.
  amount INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE documents IS
  'Fotos y documentos de clientes, empresas y trabajadores. Archivos en el bucket privado documentos.';

CREATE INDEX IF NOT EXISTS documents_booking_idx ON documents (booking_id, created_at DESC);
CREATE INDEX IF NOT EXISTS documents_customer_idx ON documents (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS documents_company_idx ON documents (company_id, created_at DESC);

-- Bucket privado. 15 MB por archivo; fotos y PDF.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'documentos', 'documentos', FALSE, 15728640,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) RLS
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE workers ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_workers ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
