import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { normalizeUsername } from '@/lib/adminAuth'
import { hashPassword, validatePasswordStrength } from '@/lib/passwordHash'
import { getActorFromRequest, logAdminAction } from '@/lib/activityLog'
import { hasAdminAction, normalizeAdminRole } from '@/lib/adminPermissions'
import { ProfileError, profileForAssignment } from '@/lib/adminProfiles'

export const dynamic = 'force-dynamic'

// Nunca se devuelve el password_hash al cliente.
const SAFE_FIELDS = 'id, username, display_name, role, is_active, must_change_password, created_at, last_login_at'

export async function GET(request: NextRequest) {
  try {
    if (!(await hasAdminAction(request, 'users.manage'))) {
      return NextResponse.json({ error: 'Tu perfil no tiene permiso para gestionar usuarios' }, { status: 403 })
    }

    const { data, error } = await supabaseAdmin
      .from('admin_users')
      // Lectura compatible antes de aplicar la migración de roles; se proyectan los
      // campos seguros manualmente para no exponer password_hash.
      .select('*')
      .order('created_at', { ascending: true })

    if (error) {
      console.error('[admin/users] Error listando:', error)
      return NextResponse.json({ error: 'Error obteniendo usuarios' }, { status: 500 })
    }

    return NextResponse.json(
      (data || []).map((user: any) => ({
        id: user.id,
        username: user.username,
        display_name: user.display_name,
        role: normalizeAdminRole(user.role),
        // undefined antes de correr add_admin_profiles.sql: la pantalla cae al rol de siempre.
        profile_id: user.profile_id ?? null,
        is_active: user.is_active,
        must_change_password: user.must_change_password,
        created_at: user.created_at,
        last_login_at: user.last_login_at,
      }))
    )
  } catch (error) {
    console.error('Error en /api/admin/users GET:', error)
    return NextResponse.json({ error: 'Error obteniendo usuarios' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!(await hasAdminAction(request, 'users.manage'))) {
      return NextResponse.json({ error: 'Tu perfil no tiene permiso para crear usuarios' }, { status: 403 })
    }

    const { username, displayName, password, role, profileId } = await request.json()

    const normalized = normalizeUsername(String(username || ''))
    if (!normalized || !displayName || !password) {
      return NextResponse.json(
        { error: 'Usuario, nombre y contraseña son obligatorios' },
        { status: 400 }
      )
    }

    const strengthError = validatePasswordStrength(String(password))
    if (strengthError) {
      return NextResponse.json({ error: strengthError }, { status: 400 })
    }

    const { data: existing } = await supabaseAdmin
      .from('admin_users')
      .select('id')
      .eq('username', normalized)
      .maybeSingle()

    if (existing) {
      return NextResponse.json({ error: 'Ese usuario ya existe' }, { status: 409 })
    }

    const password_hash = await hashPassword(String(password))

    // Con perfiles (add_admin_profiles.sql) el usuario nace con uno; sin ellos, con el rol.
    let assignment: Awaited<ReturnType<typeof profileForAssignment>> | null = null
    if (profileId) {
      try {
        assignment = await profileForAssignment(profileId)
      } catch (error) {
        if (error instanceof ProfileError) return NextResponse.json({ error: error.message }, { status: error.status })
        throw error
      }
    }

    const { data: created, error } = await supabaseAdmin
      .from('admin_users')
      .insert({
        username: normalized,
        display_name: String(displayName).trim(),
        password_hash,
        ...(assignment ? { profile_id: assignment.profile.id } : {}),
        role: assignment ? assignment.role : normalizeAdminRole(role),
        // Contraseña definida por otra persona: el titular debe cambiarla al entrar.
        must_change_password: true,
      })
      .select(SAFE_FIELDS)
      .single()

    if (error) {
      console.error('[admin/users] Error creando:', error)
      return NextResponse.json({ error: 'No se pudo crear el usuario' }, { status: 500 })
    }

    await logAdminAction({
      actor: getActorFromRequest(request),
      action: 'user.created',
      entityType: 'user',
      entityId: created.id,
      entityLabel: created.username,
      summary: `Creó el usuario ${created.username} (${created.display_name})`,
      request,
    })

    return NextResponse.json({ success: true, user: created }, { status: 201 })
  } catch (error) {
    console.error('Error en /api/admin/users POST:', error)
    return NextResponse.json({ error: 'Error creando el usuario' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    if (!(await hasAdminAction(request, 'users.manage'))) {
      return NextResponse.json({ error: 'Tu perfil no tiene permiso para modificar usuarios' }, { status: 403 })
    }

    const { id, isActive, newPassword, role, profileId } = await request.json()
    if (!id) {
      return NextResponse.json({ error: 'ID requerido' }, { status: 400 })
    }

    const actor = getActorFromRequest(request)

    const { data: target } = await supabaseAdmin
      .from('admin_users')
      .select('*')
      .eq('id', id)
      .maybeSingle()

    if (!target) {
      return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 })
    }

    // Cambio de perfil (con add_admin_profiles.sql corrida). Nadie puede pasarse a sí
    // mismo a un perfil sin gestión de usuarios: no podría deshacerlo desde el panel.
    if (profileId) {
      let assignment: Awaited<ReturnType<typeof profileForAssignment>>
      try {
        assignment = await profileForAssignment(profileId)
      } catch (error) {
        if (error instanceof ProfileError) return NextResponse.json({ error: error.message }, { status: error.status })
        throw error
      }
      if (actor?.username === target.username && !assignment.canManageUsers) {
        return NextResponse.json(
          { error: 'No puedes pasarte a un perfil sin permiso de usuarios y perfiles' },
          { status: 400 }
        )
      }
      const { error } = await supabaseAdmin
        .from('admin_users')
        .update({ profile_id: assignment.profile.id, role: assignment.role })
        .eq('id', id)
      if (error) {
        console.error('[admin/users] Error cambiando perfil:', error)
        return NextResponse.json({ error: 'No se pudo cambiar el perfil' }, { status: 500 })
      }
      await logAdminAction({
        actor,
        action: 'user.role_changed',
        entityType: 'user',
        entityId: id,
        entityLabel: target.username,
        summary: `Cambió el perfil de ${target.username} a ${assignment.profile.name}`,
        changes: { profile_id: { from: target.profile_id ?? null, to: assignment.profile.id } },
        request,
      })
      return NextResponse.json({ success: true })
    }

    // Cambio de rol heredado (antes de los perfiles). Nadie puede quitarse a sí mismo el rol Administrador: el
    // siguiente cambio ya no podría revertirlo desde el panel.
    if (role === 'administrator' || role === 'staff') {
      if (actor?.username === target.username && role !== 'administrator') {
        return NextResponse.json(
          { error: 'No puedes quitarte tu propio perfil Administrador' },
          { status: 400 }
        )
      }

      const nextRole = normalizeAdminRole(role)
      const { error } = await supabaseAdmin
        .from('admin_users')
        .update({ role: nextRole })
        .eq('id', id)

      if (error) {
        console.error('[admin/users] Error cambiando rol:', error)
        return NextResponse.json({ error: 'No se pudo cambiar el perfil' }, { status: 500 })
      }

      await logAdminAction({
        actor,
        action: 'user.role_changed',
        entityType: 'user',
        entityId: id,
        entityLabel: target.username,
        summary: `Cambió el perfil de ${target.username} a ${nextRole === 'administrator' ? 'Administrador' : 'Secretaría'}`,
        changes: { role: { from: normalizeAdminRole(target.role), to: nextRole } },
        request,
      })

      return NextResponse.json({ success: true })
    }

    // Reseteo de contraseña por otro admin
    if (typeof newPassword === 'string' && newPassword.length > 0) {
      const strengthError = validatePasswordStrength(newPassword)
      if (strengthError) {
        return NextResponse.json({ error: strengthError }, { status: 400 })
      }

      const password_hash = await hashPassword(newPassword)
      const { error } = await supabaseAdmin
        .from('admin_users')
        .update({ password_hash, must_change_password: true })
        .eq('id', id)

      if (error) {
        console.error('[admin/users] Error reseteando contraseña:', error)
        return NextResponse.json(
          { error: 'No se pudo actualizar la contraseña' },
          { status: 500 }
        )
      }

      await logAdminAction({
        actor,
        action: 'user.password_reset',
        entityType: 'user',
        entityId: id,
        entityLabel: target.username,
        // Nunca se guarda la contraseña, solo el hecho.
        summary: `Reseteó la contraseña de ${target.username}`,
        request,
      })

      return NextResponse.json({ success: true })
    }

    // Activar / desactivar
    if (typeof isActive === 'boolean') {
      // Nadie puede desactivarse a sí mismo: se quedaría fuera del panel.
      if (!isActive && actor?.username === target.username) {
        return NextResponse.json(
          { error: 'No puedes desactivar tu propio usuario' },
          { status: 400 }
        )
      }

      // Tampoco se puede dejar el panel sin ningún usuario activo.
      if (!isActive) {
        const { count } = await supabaseAdmin
          .from('admin_users')
          .select('id', { count: 'exact', head: true })
          .eq('is_active', true)

        if ((count || 0) <= 1) {
          return NextResponse.json(
            { error: 'Debe quedar al menos un usuario activo' },
            { status: 400 }
          )
        }
      }

      const { error } = await supabaseAdmin
        .from('admin_users')
        .update({ is_active: isActive })
        .eq('id', id)

      if (error) {
        console.error('[admin/users] Error cambiando estado:', error)
        return NextResponse.json({ error: 'No se pudo actualizar' }, { status: 500 })
      }

      await logAdminAction({
        actor,
        action: isActive ? 'user.updated' : 'user.deactivated',
        entityType: 'user',
        entityId: id,
        entityLabel: target.username,
        summary: isActive
          ? `Reactivó el usuario ${target.username}`
          : `Desactivó el usuario ${target.username}`,
        changes: { is_active: { from: target.is_active, to: isActive } },
        request,
      })

      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'Nada que actualizar' }, { status: 400 })
  } catch (error) {
    console.error('Error en /api/admin/users PATCH:', error)
    return NextResponse.json({ error: 'Error actualizando el usuario' }, { status: 500 })
  }
}
