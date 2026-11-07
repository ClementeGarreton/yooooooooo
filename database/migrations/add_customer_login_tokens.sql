-- Migration: Links de acceso al Panel del Cliente (/mi-cuenta)
-- Date: 2026-10-01
-- Rama: feat/perfil-del-cliente (Módulo 1 de Propuesta_Panel_Perfiles_2026-09)
--
-- QUÉ RESUELVE
-- El cliente entra a su cuenta con un link que le llega al correo, sin contraseña
-- permanente. El link tiene que vencer y servir UNA sola vez: si alguien reenvía el
-- correo o lo encuentra días después, el link ya no abre nada. Para "una sola vez" hace
-- falta guardar algo; una firma sola (como la sesión de choferes) no sabe si ya se usó.
--
-- QUÉ AGREGA
--   customer_login_tokens -> un link pedido por cliente. Solo se guarda el HASH del
--                            token: quien lea la tabla no puede armar un link que abra.
--
-- ES SOLO ADITIVA, A PROPÓSITO
-- La base es una sola para producción y para la rama del panel. Esta migración no toca
-- ninguna tabla existente, así que se puede correr antes de fusionar la rama sin que
-- `main` note nada.
--
-- RLS activo y CERO policies, igual que el resto (ver enable_rls_all_tables.sql): la app
-- entra con service_role desde el servidor, y `anon` no ve nada.

CREATE TABLE IF NOT EXISTS customer_login_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  -- SHA-256 en hex del token que viaja en el link. El token en claro no se guarda.
  token_hash TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  -- NULL = sin usar. Se marca en el mismo UPDATE que valida el link, así dos clics
  -- simultáneos no pueden abrir dos sesiones con el mismo link.
  used_at TIMESTAMPTZ,
  requested_ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE customer_login_tokens IS
  'Links de acceso de un solo uso al Panel del Cliente. Solo se guarda el hash del token.';

-- Para contar cuántos links pidió un cliente en los últimos minutos (tope anti spam).
CREATE INDEX IF NOT EXISTS customer_login_tokens_customer_idx
  ON customer_login_tokens (customer_id, created_at DESC);

ALTER TABLE customer_login_tokens ENABLE ROW LEVEL SECURITY;
