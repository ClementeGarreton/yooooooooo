import { NextRequest, NextResponse } from 'next/server'
import { getActorFromRequest, logAdminAction } from '@/lib/activityLog'
import { CompanyError } from '@/lib/companies'
import { getCompanySignupLink, updateCompanySignupLink, type CompanySignupAction } from '@/lib/companySignup'

export const dynamic = 'force-dynamic'

const ACTIONS: CompanySignupAction[] = ['open', 'rotate', 'close', 'require-pin', 'no-pin']

/** El link de registro de empresas (y su clave). */
export async function GET() {
  return NextResponse.json(await getCompanySignupLink())
}

/** Abre, cambia o cierra el link, o pide/saca la clave. Body: `{ action }`. */
export async function POST(request: NextRequest) {
  const actor = getActorFromRequest(request)
  const body = await request.json().catch(() => ({}))
  if (!ACTIONS.includes(body?.action)) return NextResponse.json({ error: 'Acción inválida' }, { status: 400 })
  try {
    const link = await updateCompanySignupLink(body.action, actor?.username || 'administrador')
    await logAdminAction({
      actor,
      action: 'company.signup_link_changed',
      entityType: 'settings',
      entityLabel: 'Link de registro de empresas',
      summary: { open: 'Abrió', rotate: 'Cambió', close: 'Cerró', 'require-pin': 'Pidió clave en', 'no-pin': 'Sacó la clave de' }[body.action as CompanySignupAction] + ' el link de registro de empresas',
      request,
    })
    return NextResponse.json(link)
  } catch (error) {
    if (error instanceof CompanyError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('[admin/company-signup] Error:', error)
    return NextResponse.json({ error: 'No se pudo guardar el link' }, { status: 500 })
  }
}
