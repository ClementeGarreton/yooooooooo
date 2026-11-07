import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getActorFromRequest, logAdminAction } from '@/lib/activityLog'
import { UUID_RE } from '@/lib/workers'

export const dynamic = 'force-dynamic'

const MISSING = 'Falta correr la migración add_worker_comments.sql.'

/** Comentarios internos de la ficha de un trabajador (tabla de add_worker_comments.sql). */
export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  if (!UUID_RE.test(params.id)) return NextResponse.json({ error: 'Trabajador no encontrado' }, { status: 404 })
  const { data, error } = await supabaseAdmin
    .from('worker_comments')
    .select('id, comment, created_by, created_at')
    .eq('worker_id', params.id)
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) return NextResponse.json({ available: false, comments: [] })
  return NextResponse.json({ available: true, comments: data || [] })
}

/** Agrega un comentario. Body: `{ comment }`. Queda con fecha y con quién lo escribió. */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  if (!UUID_RE.test(params.id)) return NextResponse.json({ error: 'Trabajador no encontrado' }, { status: 404 })
  const body = await request.json().catch(() => ({}))
  const comment = typeof body?.comment === 'string' ? body.comment.trim().slice(0, 1000) : ''
  if (!comment) return NextResponse.json({ error: 'Escribe el comentario.' }, { status: 400 })

  const { data: worker } = await supabaseAdmin.from('workers').select('id, name, code').eq('id', params.id).maybeSingle()
  if (!worker) return NextResponse.json({ error: 'Trabajador no encontrado' }, { status: 404 })

  const actor = getActorFromRequest(request)
  const { data, error } = await supabaseAdmin
    .from('worker_comments')
    .insert({ worker_id: worker.id, comment, created_by: actor?.username || null })
    .select('id, comment, created_by, created_at')
    .single()
  if (error || !data) {
    console.error('[admin/workers/comments] Error:', error?.message)
    return NextResponse.json({ error: MISSING }, { status: 409 })
  }
  await logAdminAction({
    actor,
    action: 'worker.comment_added',
    entityType: 'worker',
    entityId: worker.id,
    entityLabel: `${worker.name} (${worker.code})`,
    summary: `Agregó un comentario en la ficha de ${worker.name}`,
    request,
  })
  return NextResponse.json({ ok: true, comment: data })
}
