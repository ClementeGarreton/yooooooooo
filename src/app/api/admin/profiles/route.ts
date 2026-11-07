import { NextRequest, NextResponse } from 'next/server'
import { getActorFromRequest, logAdminAction } from '@/lib/activityLog'
import { hasAdminAction } from '@/lib/adminPermissions'
import { ProfileError, createProfile, listProfiles } from '@/lib/adminProfiles'

export const dynamic = 'force-dynamic'

const DENIED = { error: 'Tu perfil no tiene permiso para gestionar usuarios y perfiles.' }

/** Perfiles del panel con cuántos usuarios tiene cada uno. */
export async function GET(request: NextRequest) {
  if (!(await hasAdminAction(request, 'users.manage'))) return NextResponse.json(DENIED, { status: 403 })
  return NextResponse.json(await listProfiles())
}

/** Crea un perfil. Body: `{ name, description?, permissions: { modules, actions } }`. */
export async function POST(request: NextRequest) {
  if (!(await hasAdminAction(request, 'users.manage'))) return NextResponse.json(DENIED, { status: 403 })
  try {
    const actor = getActorFromRequest(request)
    const profile = await createProfile(await request.json().catch(() => ({})), actor?.username || 'administrador')
    await logAdminAction({
      actor,
      action: 'profile.created',
      entityType: 'profile',
      entityId: profile.id,
      entityLabel: profile.name,
      summary: `Creó el perfil ${profile.name}`,
      changes: { permissions: { from: null, to: profile.permissions } },
      request,
    })
    return NextResponse.json({ ok: true, profile }, { status: 201 })
  } catch (error) {
    if (error instanceof ProfileError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('[admin/profiles] Error creando:', error)
    return NextResponse.json({ error: 'No se pudo crear el perfil' }, { status: 500 })
  }
}
