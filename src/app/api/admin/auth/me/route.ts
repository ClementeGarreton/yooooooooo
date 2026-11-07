import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { ENV_ADMIN_ID, normalizeUsername } from '@/lib/adminAuth'
import { getAdminAccess, getAdminRole } from '@/lib/adminPermissions'
import { FULL_ACCESS } from '@/lib/adminAccess'

export const dynamic = 'force-dynamic'

/** Usuario de la sesión actual. La identidad sale del header que inyecta el middleware. */
export async function GET(request: NextRequest) {
  try {
    const username = normalizeUsername(request.headers.get('x-admin-user') || '')
    const userId = request.headers.get('x-admin-user-id') || ''

    if (!username) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    // Acceso de emergencia por variables de entorno: no está en la tabla.
    if (userId === ENV_ADMIN_ID) {
      return NextResponse.json({
        username,
        displayName: 'Administrador',
        mustChangePassword: false,
        canChangePassword: false,
        role: 'administrator',
        access: FULL_ACCESS,
      })
    }

    const { data: user } = await supabaseAdmin
      .from('admin_users')
      .select('username, display_name, must_change_password')
      .eq('username', username)
      .maybeSingle()

    const role = await getAdminRole(request)
    // Qué módulos y acciones tiene según su perfil: el menú se arma con esto. Es solo para
    // mostrar; lo que de verdad manda es el candado del servidor.
    const access = await getAdminAccess(request)

    return NextResponse.json({
      username,
      displayName: user?.display_name || username,
      mustChangePassword: Boolean(user?.must_change_password),
      canChangePassword: true,
      role,
      access,
    })
  } catch (error) {
    console.error('Error en /api/admin/auth/me:', error)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
