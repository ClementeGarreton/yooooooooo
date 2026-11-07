import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { diffFields, getActorFromRequest, logAdminAction } from '@/lib/activityLog'
import { COMPANY_FIELDS, CompanyError, UUID_RE, getCompanyDetail, parseCompanyInput } from '@/lib/companies'

export const dynamic = 'force-dynamic'

/** Ficha de una empresa: datos, personas, reservas y documentos. */
export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const detail = await getCompanyDetail(params.id)
  if (!detail) return NextResponse.json({ error: 'Empresa no encontrada' }, { status: 404 })
  return NextResponse.json(detail)
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  if (!UUID_RE.test(params.id)) return NextResponse.json({ error: 'Empresa no encontrada' }, { status: 404 })
  try {
    const input = parseCompanyInput(await request.json(), true)
    if (Object.keys(input).length === 0) return NextResponse.json({ error: 'Nada que cambiar' }, { status: 400 })

    const { data: before } = await supabaseAdmin.from('companies').select(COMPANY_FIELDS).eq('id', params.id).maybeSingle()
    if (!before) return NextResponse.json({ error: 'Empresa no encontrada' }, { status: 404 })

    const { data, error } = await supabaseAdmin
      .from('companies')
      .update({ ...input, updated_at: new Date().toISOString() })
      .eq('id', params.id)
      .select(COMPANY_FIELDS)
      .single()
    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: 'Ya existe una empresa con ese RUT.' }, { status: 409 })
      }
      throw error
    }

    const changes = diffFields(before, input, Object.keys(input))
    if (changes && Object.keys(changes).length > 0) {
      await logAdminAction({
        actor: getActorFromRequest(request),
        action: 'company.updated',
        entityType: 'company',
        entityId: data.id,
        entityLabel: `${data.razon_social} (${data.code})`,
        summary: `Editó los datos de ${data.razon_social}`,
        changes,
        request,
      })
    }
    return NextResponse.json({ company: data })
  } catch (error) {
    if (error instanceof CompanyError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('[admin/companies] Error editando:', error)
    return NextResponse.json({ error: 'No se pudo guardar la empresa' }, { status: 500 })
  }
}
