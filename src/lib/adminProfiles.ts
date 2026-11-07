/**
 * Perfiles de los usuarios del panel (rediseño del admin, fase 2). Un perfil enciende o
 * apaga cada módulo del menú y, aparte, las acciones delicadas. Las claves válidas salen
 * del registro único (adminModules.ts); acá solo se guardan y se leen.
 */

import { supabaseAdmin } from '@/lib/supabase'
import { canDoAction, resolveAccess, sanitizePermissions, type StoredPermissions } from '@/lib/adminAccess'

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface AdminProfile {
  id: string
  name: string
  description: string | null
  permissions: StoredPermissions
  is_system: boolean
  /** Usuarios que hoy tienen este perfil. */
  userCount: number
}

export class ProfileError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message)
    this.name = 'ProfileError'
  }
}

/** 42P01 / PGRST205 = falta correr add_admin_profiles.sql. */
export function isMissingProfilesTable(error: { code?: string } | null | undefined): boolean {
  return error?.code === '42P01' || error?.code === 'PGRST205'
}

const FIELDS = 'id, name, description, permissions, is_system'

export async function listProfiles(): Promise<{ available: boolean; profiles: AdminProfile[] }> {
  const { data, error } = await supabaseAdmin.from('admin_profiles').select(FIELDS).order('is_system', { ascending: false }).order('name')
  if (error) {
    if (!isMissingProfilesTable(error)) console.error('[adminProfiles] Error listando:', error)
    return { available: !isMissingProfilesTable(error), profiles: [] }
  }
  const { data: users } = await supabaseAdmin.from('admin_users').select('profile_id').not('profile_id', 'is', null)
  const counts = new Map<string, number>()
  for (const u of users || []) counts.set(u.profile_id, (counts.get(u.profile_id) || 0) + 1)
  return {
    available: true,
    profiles: (data || []).map((p: any) => ({ ...p, permissions: p.permissions || {}, userCount: counts.get(p.id) || 0 })),
  }
}

function parseName(value: unknown): string {
  const name = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, 60) : ''
  if (name.length < 2) throw new ProfileError('Ponle un nombre al perfil.')
  return name
}

const parseDescription = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, 200) : null

export async function createProfile(body: any, actor: string) {
  const { data, error } = await supabaseAdmin
    .from('admin_profiles')
    .insert({
      name: parseName(body?.name),
      description: parseDescription(body?.description),
      permissions: sanitizePermissions(body?.permissions),
      created_by: actor,
    })
    .select(FIELDS)
    .single()
  if (error) {
    if (error.code === '23505') throw new ProfileError('Ya existe un perfil con ese nombre.', 409)
    throw error
  }
  return data
}

/**
 * Edita un perfil. `actorProfileId` = perfil de quien edita: si es el suyo, no puede
 * quitarse el permiso de gestionar usuarios y perfiles (no podría deshacerlo).
 */
export async function updateProfile(profileId: string, body: any, actorProfileId: string | null) {
  if (!UUID_RE.test(profileId)) throw new ProfileError('Perfil no encontrado', 404)
  const { data: current } = await supabaseAdmin.from('admin_profiles').select(FIELDS).eq('id', profileId).maybeSingle()
  if (!current) throw new ProfileError('Perfil no encontrado', 404)
  if (current.is_system) throw new ProfileError('El perfil Administrador siempre tiene todo y no se edita.')

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (body?.name !== undefined) update.name = parseName(body.name)
  if (body?.description !== undefined) update.description = parseDescription(body.description)
  if (body?.permissions !== undefined) {
    const permissions = sanitizePermissions(body.permissions)
    if (actorProfileId === profileId && !canDoAction(resolveAccess('staff', { permissions }), 'users.manage')) {
      throw new ProfileError('Es tu propio perfil: no puedes quitarte el permiso de usuarios y perfiles.')
    }
    update.permissions = permissions
  }

  const { data, error } = await supabaseAdmin.from('admin_profiles').update(update).eq('id', profileId).select(FIELDS).single()
  if (error) {
    if (error.code === '23505') throw new ProfileError('Ya existe un perfil con ese nombre.', 409)
    throw error
  }
  return { before: current, after: data }
}

/** Perfil a asignar a un usuario, validado. Devuelve también el rol heredado que le toca. */
export async function profileForAssignment(profileId: unknown) {
  if (typeof profileId !== 'string' || !UUID_RE.test(profileId)) throw new ProfileError('Perfil inválido.')
  const { data } = await supabaseAdmin.from('admin_profiles').select(FIELDS).eq('id', profileId).maybeSingle()
  if (!data) throw new ProfileError('Ese perfil no existe.', 404)
  return {
    profile: data,
    // `role` se mantiene al día porque todavía lo lee código más antiguo.
    role: data.is_system ? ('administrator' as const) : ('staff' as const),
    canManageUsers: canDoAction(resolveAccess('staff', data), 'users.manage'),
  }
}
