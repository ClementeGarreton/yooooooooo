import type { NextRequest } from 'next/server'
import { ENV_ADMIN_ID } from '@/lib/adminAuth'
import { supabaseAdmin } from '@/lib/supabase'
import { FULL_ACCESS, canDoAction, resolveAccess, type AdminAccess } from '@/lib/adminAccess'
import type { AdminActionId } from '@/lib/adminModules'

export type AdminRole = 'administrator' | 'staff'

export function normalizeAdminRole(value: unknown): AdminRole {
  return value === 'administrator' ? 'administrator' : 'staff'
}

/**
 * Resuelve el rol exclusivamente desde la identidad firmada que inyecta el middleware.
 * Nunca acepta un rol enviado por el navegador.
 */
export async function getAdminRole(request: NextRequest): Promise<AdminRole> {
  const userId = request.headers.get('x-admin-user-id') || ''
  if (userId === ENV_ADMIN_ID) return 'administrator'
  if (!userId) return 'staff'

  const { data, error } = await supabaseAdmin
    .from('admin_users')
    .select('role')
    .eq('id', userId)
    .maybeSingle()

  // Antes de aplicar la migración la columna no existe. El fallback seguro es staff:
  // la operación diaria sigue viva, pero nadie recibe privilegios financieros por error.
  if (error) {
    console.error('[adminPermissions] No se pudo resolver el rol:', error.message)
    return 'staff'
  }

  return normalizeAdminRole(data?.role)
}

export async function isAdministrator(request: NextRequest): Promise<boolean> {
  return (await getAdminRole(request)) === 'administrator'
}

/**
 * Acceso completo del usuario de la sesión: módulos, acciones y nombre de su perfil. Igual
 * que el rol, sale solo de la identidad firmada que inyecta el middleware.
 *
 * Antes de correr add_admin_profiles.sql (la columna `profile_id` no existe) la primera
 * consulta falla y se resuelve con el rol de siempre: 'administrator' todo, 'staff' la
 * operación diaria. Si ni eso se puede leer, queda como 'staff'.
 */
export async function getAdminAccess(request: NextRequest): Promise<AdminAccess> {
  const userId = request.headers.get('x-admin-user-id') || ''
  if (userId === ENV_ADMIN_ID) return FULL_ACCESS
  if (!userId) return resolveAccess('staff', null)

  const { data, error } = await supabaseAdmin
    .from('admin_users')
    .select('role, profile:admin_profiles(name, is_system, permissions)')
    .eq('id', userId)
    .maybeSingle()
  if (!error && data) {
    // PostgREST devuelve la relación como objeto (o como lista de uno, según la versión).
    const profile = Array.isArray(data.profile) ? data.profile[0] : data.profile
    return resolveAccess(data.role, profile || null)
  }
  return resolveAccess(await getAdminRole(request), null)
}

/** ¿Puede el usuario de la sesión hacer esta acción delicada? Ante la duda, no. */
export async function hasAdminAction(request: NextRequest, action: AdminActionId): Promise<boolean> {
  return canDoAction(await getAdminAccess(request), action)
}
