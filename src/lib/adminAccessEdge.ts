// Acceso del usuario para el CANDADO POR RUTA del middleware.
//
// El middleware no usa el cliente de Supabase del resto de la app: pide el perfil del
// usuario directo a la API REST, con la clave de servicio, y lo recuerda unos segundos
// para no hacer una consulta por cada llamada del panel (una pantalla dispara varias).
//
// Si no se puede resolver el acceso —no se corrió add_admin_profiles.sql, falla la red—
// devuelve null y el middleware DEJA PASAR: el panel sigue funcionando como hoy, con la
// sesión de admin como única barrera. Las acciones delicadas no dependen de esto: cada
// ruta las vuelve a comprobar contra la base (adminPermissions.ts) y ahí, ante la duda,
// se niega.

import { ENV_ADMIN_ID, FULL_ACCESS, resolveAccess, type AdminAccess } from '@/lib/adminAccess'

/** Un cambio de perfil tarda a lo más esto en llegarle a un usuario con el panel abierto. */
const CACHE_MS = 20_000
const cache = new Map<string, { expires: number; access: AdminAccess | null }>()
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function getAccessForMiddleware(userId: string): Promise<AdminAccess | null> {
  if (userId === ENV_ADMIN_ID) return FULL_ACCESS
  if (!UUID_RE.test(userId)) return null

  const now = Date.now()
  const hit = cache.get(userId)
  if (hit && hit.expires > now) return hit.access

  let access: AdminAccess | null = null
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (url && key) {
      const res = await fetch(
        `${url}/rest/v1/admin_users?id=eq.${userId}&select=role,profile:admin_profiles(name,is_system,permissions)&limit=1`,
        { headers: { apikey: key, Authorization: `Bearer ${key}` }, cache: 'no-store' }
      )
      if (res.ok) {
        const rows = (await res.json()) as { role?: string; profile?: any }[]
        if (rows[0]) access = resolveAccess(rows[0].role, rows[0].profile || null)
      }
    }
  } catch {
    access = null
  }

  if (cache.size > 500) cache.clear()
  cache.set(userId, { expires: now + CACHE_MS, access })
  return access
}
