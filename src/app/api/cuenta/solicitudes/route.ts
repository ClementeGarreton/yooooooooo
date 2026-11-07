import { NextRequest, NextResponse } from 'next/server'
import { customerIdFromRequest } from '@/lib/customerSession'
import { ServiceRequestError, createServiceRequest } from '@/lib/serviceRequests'

export const dynamic = 'force-dynamic'

/**
 * El cliente (o la empresa) pide un servicio desde su panel. Body:
 * `{ serviceType, origin, destination, date, time?, contact?, description, forCompany? }`.
 * No crea una reserva ni ocupa cupo: queda pendiente hasta que el equipo la aprueba.
 */
export async function POST(request: NextRequest) {
  const customerId = await customerIdFromRequest(request)
  if (!customerId) return NextResponse.json({ error: 'Tu sesión venció. Vuelve a entrar.' }, { status: 401 })

  try {
    const created = await createServiceRequest(customerId, await request.json().catch(() => ({})))
    return NextResponse.json({ ok: true, code: created.code }, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceRequestError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('[cuenta/solicitudes] Error:', error)
    return NextResponse.json({ error: 'No pudimos enviar la solicitud. Intenta de nuevo.' }, { status: 500 })
  }
}
