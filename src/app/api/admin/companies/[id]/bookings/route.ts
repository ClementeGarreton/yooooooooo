import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getActorFromRequest, logAdminAction } from '@/lib/activityLog'
import { UUID_RE } from '@/lib/companies'

export const dynamic = 'force-dynamic'

/**
 * Asigna reservas a la empresa (lo que se le va a facturar) o las quita.
 * Body: `{ bookingIds: string[], assign: boolean }`.
 *
 * Solo se asignan reservas de personas de ESTA empresa y que no sean de otra; solo se
 * quitan las que hoy son de esta. Lo que no cumple se ignora y se informa cuántas pasaron.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const body = await request.json().catch(() => ({}))
  const ids: string[] = Array.isArray(body?.bookingIds)
    ? body.bookingIds.filter((id: unknown) => typeof id === 'string' && UUID_RE.test(id)).slice(0, 200)
    : []
  const assign = body?.assign !== false
  if (!UUID_RE.test(params.id) || ids.length === 0) {
    return NextResponse.json({ error: 'Solicitud inválida' }, { status: 400 })
  }

  const { data: company } = await supabaseAdmin
    .from('companies')
    .select('id, code, razon_social')
    .eq('id', params.id)
    .maybeSingle()
  if (!company) return NextResponse.json({ error: 'Empresa no encontrada' }, { status: 404 })

  let allowed: { id: string; code: string | null }[] = []
  if (assign) {
    const { data: members } = await supabaseAdmin.from('customers').select('id').eq('company_id', company.id)
    const memberIds = (members || []).map((m) => m.id)
    if (memberIds.length > 0) {
      const { data } = await supabaseAdmin
        .from('bookings')
        .select('id, code')
        .in('id', ids)
        .in('customer_id', memberIds)
        .is('company_id', null)
      allowed = data || []
    }
  } else {
    const { data } = await supabaseAdmin.from('bookings').select('id, code').in('id', ids).eq('company_id', company.id)
    allowed = data || []
  }
  if (allowed.length === 0) {
    return NextResponse.json({ error: 'Ninguna de esas reservas se puede cambiar' }, { status: 409 })
  }

  let update = supabaseAdmin
    .from('bookings')
    .update({ company_id: assign ? company.id : null })
    .in('id', allowed.map((b) => b.id))
  // Misma condición que el filtro, por si otra persona cambió la reserva entre medio.
  update = assign ? update.is('company_id', null) : update.eq('company_id', company.id)
  const { error } = await update
  if (error) {
    console.error('[admin/companies/bookings] Error:', error)
    return NextResponse.json({ error: 'No se pudieron cambiar las reservas' }, { status: 500 })
  }

  const codes = allowed.map((b) => b.code || b.id).join(', ')
  await logAdminAction({
    actor: getActorFromRequest(request),
    action: assign ? 'company.bookings_assigned' : 'company.bookings_unassigned',
    entityType: 'company',
    entityId: company.id,
    entityLabel: `${company.razon_social} (${company.code})`,
    summary: assign
      ? `Asignó ${allowed.length} reserva(s) a ${company.razon_social}: ${codes}`
      : `Quitó ${allowed.length} reserva(s) de ${company.razon_social}: ${codes}`,
    changes: { bookings: { from: assign ? null : company.code, to: assign ? company.code : null } },
    request,
  })
  return NextResponse.json({ ok: true, count: allowed.length })
}
