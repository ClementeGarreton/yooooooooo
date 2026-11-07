import { NextRequest, NextResponse } from 'next/server'
import { logAdminAction } from '@/lib/activityLog'
import { CompanyError } from '@/lib/companies'
import { registerCompany } from '@/lib/companySignup'
import { requestLoginLink } from '@/lib/customerLogin'
import { getClientIp } from '@/lib/rateLimit'

export const dynamic = 'force-dynamic'

/**
 * Registro de una empresa con el link que comparte Yo Me Encargo. Crea la empresa, deja a la
 * persona como encargada y le manda el correo con el link de acceso a «Mi cuenta» (el mismo
 * que pide en «Ingresar»). El tope por IP está en el middleware (RATE_LIMIT_RULES).
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Solicitud inválida' }, { status: 400 })
  try {
    const result = await registerCompany(body)
    const login = await requestLoginLink(result.email, getClientIp(request.headers, request.ip))
    await logAdminAction({
      actor: { username: result.email },
      action: 'company.self_signup',
      entityType: 'company',
      entityId: result.companyId,
      entityLabel: `${result.razonSocial} (${result.code})`,
      summary: `Se registró la empresa ${result.razonSocial} con el link de empresas`,
      request,
    })
    return NextResponse.json({ ok: true, email: result.email, linkSent: login.kind === 'accepted' && login.detail === 'sent' })
  } catch (error) {
    if (error instanceof CompanyError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('[cuenta/registro-empresa] Error:', error)
    return NextResponse.json({ error: 'No pudimos registrar la empresa. Intenta de nuevo.' }, { status: 500 })
  }
}
