-- Migration: perfiles con permisos para los usuarios del panel (rediseño del admin, fase 2)
-- Date: 2026-10-03
-- Rama: feat/admin-rediseno.
--
-- Hoy hay dos roles fijos en `admin_users.role`: 'administrator' y 'staff' (Secretaría).
-- Esto agrega PERFILES editables, como en Ordenox: cada perfil enciende o apaga cada
-- módulo del menú y, aparte, las acciones delicadas (usuarios y perfiles, cupones y
-- referidos, emitir facturas).
--
-- QUÉ AGREGA
--   admin_profiles          -> un perfil: nombre y sus permisos.
--   admin_users.profile_id  -> el perfil de cada usuario.
--
-- QUÉ NO CAMBIA
--   - `admin_users.role` se conserva y se mantiene al día (perfil Administrador =
--     'administrator', cualquier otro = 'staff'): es lo que lee el código que está hoy en
--     producción, así que correr esto ANTES de fusionar la rama no rompe nada.
--   - Nadie gana ni pierde nada: quien hoy es 'administrator' queda con el perfil
--     «Administrador» (todo) y quien es 'staff' con «Secretaría» (todos los módulos, sin
--     las acciones delicadas), que es exactamente lo que cada uno puede hacer hoy.
--
-- ES SOLO ADITIVA. Se puede correr dos veces.
-- RLS activo y CERO policies, igual que el resto (ver enable_rls_all_tables.sql).

CREATE TABLE IF NOT EXISTS admin_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  description TEXT,
  -- { "modules": { "<id del módulo>": true|false }, "actions": { "<clave>": true|false } }
  -- Las claves válidas viven en el código (src/lib/adminModules.ts). Un módulo o una
  -- acción que no figure acá vale como apagado.
  permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- TRUE = el perfil «Administrador»: siempre tiene todo y no se puede editar, para que
  -- nadie se quede fuera del panel por apagar un interruptor.
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE admin_profiles IS
  'Perfiles de los usuarios del panel: qué módulos ven y qué acciones delicadas pueden hacer.';

-- Un solo perfil de sistema.
CREATE UNIQUE INDEX IF NOT EXISTS admin_profiles_one_system ON admin_profiles (is_system) WHERE is_system;

ALTER TABLE admin_users
  ADD COLUMN IF NOT EXISTS profile_id UUID REFERENCES admin_profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS admin_users_profile_idx ON admin_users (profile_id);

-- Los dos perfiles iniciales, con lo mismo que hoy puede hacer cada rol.
INSERT INTO admin_profiles (name, description, permissions, is_system, created_by)
VALUES (
  'Administrador',
  'Acceso completo: todos los módulos y todas las acciones.',
  '{}'::jsonb,
  TRUE,
  'migración'
)
ON CONFLICT (name) DO NOTHING;

INSERT INTO admin_profiles (name, description, permissions, is_system, created_by)
VALUES (
  'Secretaría',
  'Operación diaria: todos los módulos, sin usuarios, cupones ni emisión de facturas.',
  '{
    "modules": {
      "calendar": true, "bookings": true, "approvals": true, "prospects": true,
      "new-quote": true, "customers": true, "companies": true, "fleet": true,
      "schedule": true, "activity": true, "settings": true
    },
    "actions": {}
  }'::jsonb,
  FALSE,
  'migración'
)
ON CONFLICT (name) DO NOTHING;

-- Cada usuario que todavía no tiene perfil recibe el que corresponde a su rol de hoy.
UPDATE admin_users u
SET profile_id = p.id
FROM admin_profiles p
WHERE u.profile_id IS NULL
  AND p.name = CASE WHEN u.role = 'administrator' THEN 'Administrador' ELSE 'Secretaría' END;

ALTER TABLE admin_profiles ENABLE ROW LEVEL SECURITY;
