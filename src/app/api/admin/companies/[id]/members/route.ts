import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getActorFromRequest, logAdminAction } from '@/lib/activityLog'
import { UUID_RE } from '@/lib/companies'

export const dynamic = 'force-dynamic'

async function load(companyId: string, customerId: unknown) {
  if (!UUID_RE.test(companyId) || typeof customerId !== 'string' || !UUID_RE.test(customerId)) return null
  const [company, customer] = await Promise.all([
    supabaseAdmin.from('companies').select('id, code, razon_social').eq('id', companyId).maybeSingle(),
    supabaseAdmin.from('customers').select('id, code, name, email, company_id, company_role').eq('id', customerId).maybeSingle(),
  ])
  if (!company.data || !customer.data) return null
  return { company: company.data, customer: customer.data }
}

/**
 * Asocia una persona a la empresa o le cambia el rol. Body: `{ customerId, role }`.
 * 'encargado' ve en su panel todo lo de la empresa; 'miembro', solo lo suyo.
 * No toca las reservas de la persona: esas se asignan una por una.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const body = await request.json().catch(() => ({}))
  const found = await load(params.id, body?.customerId)
  if (!found) return NextResponse.json({ error: 'Empresa o cliente no encontrado' }, { status: 404 })
  const { company, customer } = found
  const role = body?.role === 'encargado' ? 'encargado' : 'miembro'

  if (customer.company_id && customer.company_id !== company.id) {
    return NextResponse.json(
      { error: 'Esa persona ya pertenece a otra empresa. Quítala de esa empresa primero.' },
      { status: 409 }
    )
  }

  const { error } = await supabaseAdmin
    .from('customers')
    .update({ company_id: company.id, company_role: role, updated_at: new Date().toISOString() })
    .eq('id', customer.id)
  if (error) {
    console.error('[admin/companies/members] Error asociando:', error)
    return NextResponse.json({ error: 'No se pudo asociar a la persona' }, { status: 500 })
  }

  const who = customer.name || customer.email
  await logAdminAction({
    actor: getActorFromRequest(request),
    action: customer.company_id ? 'company.member_role_changed' : 'company.member_added',
    entityType: 'company',
    entityId: company.id,
    entityLabel: `${company.razon_social} (${company.code})`,
    summary: customer.company_id
      ? `Cambió a ${who} (${customer.code}) a ${role} en ${company.razon_social}`
      : `Asoció a ${who} (${customer.code}) como ${role} de ${company.razon_social}`,
    changes: { [customer.code]: { from: customer.company_role ?? null, to: role } },
    request,
  })
  return NextResponse.json({ ok: true })
}

/** Quita a una persona de la empresa. Body: `{ customerId }`. Sus reservas no cambian. */
export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const body = await request.json().catch(() => ({}))
  const found = await load(params.id, body?.customerId)
  if (!found || found.customer.company_id !== found.company.id) {
    return NextResponse.json({ error: 'Esa persona no pertenece a esta empresa' }, { status: 404 })
  }
  const { company, customer } = found

  const { error } = await supabaseAdmin
    .from('customers')
    .update({ company_id: null, company_role: null, updated_at: new Date().toISOString() })
    .eq('id', customer.id)
  if (error) {
    console.error('[admin/companies/members] Error quitando:', error)
    return NextResponse.json({ error: 'No se pudo quitar a la persona' }, { status: 500 })
  }

  await logAdminAction({
    actor: getActorFromRequest(request),
    action: 'company.member_removed',
    entityType: 'company',
    entityId: company.id,
    entityLabel: `${company.razon_social} (${company.code})`,
    summary: `Quitó a ${customer.name || customer.email} (${customer.code}) de ${company.razon_social}`,
    changes: { [customer.code]: { from: customer.company_role ?? null, to: null } },
    request,
  })
  return NextResponse.json({ ok: true })
}
