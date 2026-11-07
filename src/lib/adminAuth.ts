import { timingSafeEqual } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase'
import { verifyPassword } from '@/lib/passwordHash'

const DEFAULT_ADMIN_USERNAME = 'admin'

// El id del usuario de emergencia vive en adminAccess.ts (sin dependencias de servidor)
// para que el middleware pueda usarlo; se re-exporta acá para no romper a quien ya lo
// importaba desde este módulo.
import { ENV_ADMIN_ID } from '@/lib/adminAccess'
export { ENV_ADMIN_ID }

export interface AuthenticatedAdmin {
  id: string
  username: string
  displayName: string
  mustChangePassword: boolean
  role: 'administrator' | 'staff'
}

function safeEqualString(a: string, b: string): boolean {
  try {
    const bufA = Buffer.from(a, 'utf8')
    const bufB = Buffer.from(b, 'utf8')
    if (bufA.length !== bufB.length) return false
    return timingSafeEqual(bufA, bufB)
  } catch {
    return false
  }
}

export function isAdminAuthConfigured(): boolean {
  return Boolean(process.env.ADMIN_PASSWORD && process.env.ADMIN_PASSWORD.length > 0)
}

/** Los usuarios son emails: se normalizan para que el login no dependa de mayúsculas. */
export function normalizeUsername(username: string): string {
  return (username || '').trim().toLowerCase()
}

/**
 * Valida credenciales contra la tabla `admin_users`, con fallback al usuario de
 * variables de entorno.
 *
 * El fallback por env se mantiene a propósito como acceso de emergencia: si la tabla
 * queda vacía o Supabase no responde, el negocio no se queda sin panel.
 *
 * Devuelve el usuario autenticado, o null. Nunca detalla si falló el usuario o la
 * contraseña (no dar pistas a quien prueba credenciales).
 */
export async function authenticateAdmin(
  username: string,
  password: string
): Promise<AuthenticatedAdmin | null> {
  const normalized = normalizeUsername(username)
  if (!normalized || !password) return null

  // 1) Usuarios de la tabla
  try {
    const { data: user, error } = await supabaseAdmin
      .from('admin_users')
      // `*` mantiene el login compatible durante la ventana entre deploy y migración:
      // si la columna role todavía no existe, simplemente llega undefined y se usa staff.
      .select('*')
      .eq('username', normalized)
      .maybeSingle()

    if (!error && user) {
      if (!user.is_active) return null

      const ok = await verifyPassword(password, user.password_hash)
      if (!ok) return null

      // No bloquea el login si falla: es solo telemetría de uso.
      supabaseAdmin
        .from('admin_users')
        .update({ last_login_at: new Date().toISOString() })
        .eq('id', user.id)
        .then(undefined, (err: unknown) =>
          console.error('[adminAuth] No se pudo actualizar last_login_at:', err)
        )

      return {
        id: user.id,
        username: user.username,
        displayName: user.display_name || user.username,
        mustChangePassword: Boolean(user.must_change_password),
        role: user.role === 'administrator' ? 'administrator' : 'staff',
      }
    }
  } catch (err) {
    // Si la tabla no existe todavía (migración sin aplicar) seguimos al fallback.
    console.error('[adminAuth] Error consultando admin_users, se usa fallback env:', err)
  }

  // 2) Fallback: usuario único por variables de entorno
  const expectedUser = normalizeUsername(
    process.env.ADMIN_USERNAME || DEFAULT_ADMIN_USERNAME
  )
  const expectedPass = process.env.ADMIN_PASSWORD
  if (!expectedPass) return null

  if (safeEqualString(normalized, expectedUser) && safeEqualString(password, expectedPass)) {
    return {
      id: ENV_ADMIN_ID,
      username: expectedUser,
      displayName: 'Administrador',
      mustChangePassword: false,
      role: 'administrator',
    }
  }

  return null
}
