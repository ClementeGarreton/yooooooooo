import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getActorFromRequest, logAdminAction } from '@/lib/activityLog'
import { hasAdminAction } from '@/lib/adminPermissions'
import { ProfileError, updateProfile } from '@/lib/adminProfiles'

export const dynamic = 'force-dynamic'

/**
 * Edita un perfil: nombre, descripción o permisos. El cambio le llega a los usuarios de
 * ese perfil en segundos, sin que tengan que volver a entrar. Queda en Actividad con los
 * permisos de antes y de después.
 */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  if (!(await hasAdminAction(request, 'users.manage'))) {
    return NextResponse.json({ error: 'Tu perfil no tiene permiso para gestionar usuarios y perfiles.' }, { status: 403 })
  }
  try {
    const actor = getActorFromRequest(request)
    const { data: me } = actor?.id
      ? await supabaseAdmin.from('admin_users').select('profile_id').eq('id', actor.id).maybeSingle()
      : { data: null }
    const { before, after } = await updateProfile(params.id, await request.json().catch(() => ({})), me?.profile_id || null)
    await logAdminAction({
      actor,
      action: 'profile.updated',
      entityType: 'profile',
      entityId: after.id,
      entityLabel: after.name,
      summary: `Editó el perfil ${after.name}`,
      changes: {
        ...(before.name !== after.name ? { name: { from: before.name, to: after.name } } : {}),
        permissions: { from: before.permissions, to: after.permissions },
      },
      request,
    })
    return NextResponse.json({ ok: true, profile: after })
  } catch (error) {
    if (error instanceof ProfileError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('[admin/profiles] Error editando:', error)
    return NextResponse.json({ error: 'No se pudo guardar el perfil' }, { status: 500 })
  }
}
