import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getActorFromRequest, logAdminAction } from '@/lib/activityLog'
import { ADMIN_PREVIEW_COOKIE, ADMIN_PREVIEW_MAX_AGE, createPreviewToken } from '@/lib/adminPreview'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * «Ver como»: abre el panel de un cliente o de un trabajador en solo lectura (sesión de
 * admin: middleware). Body: `{ kind: 'customer', id | email }` o `{ kind: 'worker', id }`.
 * Deja una cookie de vista previa de 30 minutos y devuelve adónde ir. Queda en Actividad:
 * es mirar los datos de una persona desde su lugar.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const kind = body?.kind === 'worker' ? 'worker' : 'customer'

  let target: { id: string; label: string } | null = null
  if (kind === 'worker') {
    if (typeof body?.id === 'string' && UUID_RE.test(body.id)) {
      const { data } = await supabaseAdmin.from('workers').select('id, name, code').eq('id', body.id).maybeSingle()
      if (data) target = { id: data.id, label: `${data.name} (${data.code})` }
    }
  } else {
    let query = supabaseAdmin.from('customers').select('id, name, email, code')
    if (typeof body?.id === 'string' && UUID_RE.test(body.id)) query = query.eq('id', body.id)
    else if (typeof body?.email === 'string' && body.email.includes('@')) query = query.eq('email', body.email.trim().toLowerCase())
    else return NextResponse.json({ error: 'Falta indicar a quién ver' }, { status: 400 })
    const { data } = await query.maybeSingle()
    if (data) target = { id: data.id, label: `${data.name || data.email} (${data.code})` }
  }
  if (!target) {
    return NextResponse.json(
      { error: kind === 'worker' ? 'Trabajador no encontrado' : 'Esa persona todavía no tiene una cuenta de cliente (no hay ficha con ese correo).' },
      { status: 404 }
    )
  }

  await logAdminAction({
    actor: getActorFromRequest(request),
    action: 'preview.opened',
    entityType: kind === 'worker' ? 'worker' : 'customer',
    entityId: target.id,
    entityLabel: target.label,
    summary: `Abrió el panel de ${target.label} en vista de administrador (solo lectura)`,
    request,
  })

  const response = NextResponse.json({ ok: true, url: kind === 'worker' ? '/trabajos' : '/mi-cuenta' })
  response.cookies.set(ADMIN_PREVIEW_COOKIE, await createPreviewToken(kind, target.id), {
    httpOnly: true,
    secure: request.url.startsWith('https://'),
    sameSite: 'lax',
    maxAge: ADMIN_PREVIEW_MAX_AGE,
    path: '/',
  })
  return response
}

/** Sale de la vista de administrador en este navegador. */
export async function DELETE() {
  const response = NextResponse.json({ ok: true })
  response.cookies.set(ADMIN_PREVIEW_COOKIE, '', { httpOnly: true, maxAge: 0, path: '/' })
  return response
}
