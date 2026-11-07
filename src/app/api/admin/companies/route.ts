import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getActorFromRequest, logAdminAction } from '@/lib/activityLog'
import { COMPANY_FIELDS, CompanyError, listCompanies, parseCompanyInput } from '@/lib/companies'

export const dynamic = 'force-dynamic'

/** Empresas, para la pestaña Empresas del admin (sesión: middleware). */
export async function GET() {
  try {
    return NextResponse.json({ companies: await listCompanies() })
  } catch (error) {
    console.error('[admin/companies] Error listando:', error)
    return NextResponse.json({ error: 'No se pudieron cargar las empresas' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const input = parseCompanyInput(await request.json())
    const { data, error } = await supabaseAdmin.from('companies').insert(input).select(COMPANY_FIELDS).single()
    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: 'Ya existe una empresa con ese RUT.' }, { status: 409 })
      }
      throw error
    }

    await logAdminAction({
      actor: getActorFromRequest(request),
      action: 'company.created',
      entityType: 'company',
      entityId: data.id,
      entityLabel: `${data.razon_social} (${data.code})`,
      summary: `Creó la empresa ${data.razon_social}`,
      changes: { created: { from: null, to: input } },
      request,
    })
    return NextResponse.json({ company: data }, { status: 201 })
  } catch (error) {
    if (error instanceof CompanyError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('[admin/companies] Error creando:', error)
    return NextResponse.json({ error: 'No se pudo crear la empresa' }, { status: 500 })
  }
}
