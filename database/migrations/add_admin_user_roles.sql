-- Roles del panel administrativo.
--
-- `administrator` puede gestionar usuarios y reajustar montos después del abono.
-- `staff` conserva la operación diaria (secretaría/administración) sin esas facultades.
-- El acceso de emergencia definido por ADMIN_USERNAME / ADMIN_PASSWORD no vive en esta
-- tabla y el servidor lo trata siempre como `administrator`.

ALTER TABLE admin_users
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'staff';

-- Migraciones repetibles: agregar el CHECK solo si todavía no existe.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'admin_users_role_check'
      AND conrelid = 'admin_users'::regclass
  ) THEN
    ALTER TABLE admin_users
      ADD CONSTRAINT admin_users_role_check
      CHECK (role IN ('administrator', 'staff'));
  END IF;
END $$;

COMMENT ON COLUMN admin_users.role IS
  'administrator = control total y reajustes financieros; staff = operación diaria de secretaría.';

-- Los usuarios existentes quedan como `staff` por seguridad. El acceso de emergencia
-- por variables de entorno conserva el rol Administrador y desde ahí puede promoverse
-- el usuario personal de Francisco en Configuración > Usuarios.
