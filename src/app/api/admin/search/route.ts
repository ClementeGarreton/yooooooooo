import { NextRequest, NextResponse } from 'next/server'
import { getAdminAccess } from '@/lib/adminPermissions'
import { searchAdmin } from '@/lib/adminSearch'

export const dynamic = 'force-dynamic'

/** Búsqueda general del panel. `?q=`. Solo devuelve lo de los módulos que el perfil ve. */
export async function GET(request: NextRequest) {
  try {
    const access = await getAdminAccess(request)
    return NextResponse.json(await searchAdmin(request.nextUrl.searchParams.get('q'), access))
  } catch (error) {
    console.error('[admin/search] Error:', error)
    return NextResponse.json({ error: 'No se pudo buscar' }, { status: 500 })
  }
}
