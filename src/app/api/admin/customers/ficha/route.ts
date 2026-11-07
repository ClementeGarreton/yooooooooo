import { NextRequest, NextResponse } from 'next/server'
import { getActorFromRequest, logAdminAction } from '@/lib/activityLog'
import { FichaError, customerEmailById, getCustomerFicha, updateCustomerAccess } from '@/lib/adminCustomerFicha'
import { requestLoginLink } from '@/lib/customerLogin'
import { getClientIp } from '@/lib/rateLimit'

export const dynamic = 'force-dynamic'

/** Ficha de un cliente por correo: `?email=`. 404 si esa persona todavía no tiene cuenta. */
export async function GET(request: NextRequest) {
  try {
    const ficha = await getCustomerFicha(request.nextUrl.searchParams.get('email'))
    if (!ficha) {
      return NextResponse.json({ error: 'Esa persona todavía no tiene una cuenta de cliente (no hay ficha con ese correo).' }, { status: 404 })
    }
    return NextResponse.json({ ficha })
  } catch (error) {
    console.error('[admin/customers/ficha] Error:', error)
    return NextResponse.json({ error: 'No se pudo cargar la ficha' }, { status: 500 })
  }
}

/** Acceso del cliente. Body: `{ customerId, action: 'set_rut' | 'confirm_declared' | 'reset_password' | 'set_data', rut?, name?, phone? }`. */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const result = await updateCustomerAccess(body?.customerId, body?.action, body?.rut, { name: body?.name, phone: body?.phone, email: body?.email })
    await logAdminAction({
      actor: getActorFromRequest(request),
      action: body?.action === 'set_data' || body?.action === 'set_email' ? 'customer.updated' : 'customer.access_changed',
      entityType: 'customer',
      entityId: String(body?.customerId),
      entityLabel: result.label,
      summary: result.summary,
      changes: result.changes,
      request,
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof FichaError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('[admin/customers/ficha] Error guardando:', error)
    return NextResponse.json({ error: 'No se pudo guardar el cambio' }, { status: 500 })
  }
}

/**
 * Le manda al cliente el link de acceso a su correo (el mismo que pide él desde
 * «Entrar a mi cuenta»: un solo uso, 15 minutos). Body: `{ customerId }`.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const { email, label } = await customerEmailById(body?.customerId)
    const result = await requestLoginLink(email, getClientIp(request.headers, request.ip))
    await logAdminAction({
      actor: getActorFromRequest(request),
      action: 'customer.login_link_sent',
      entityType: 'customer',
      entityId: String(body?.customerId),
      entityLabel: label,
      summary: `Pidió enviarle a ${label} el link de acceso a su correo`,
      request,
    })
    // sent | throttled (ya se le mandaron varios hace poco) | send_failed | not_customer
    return NextResponse.json({ ok: true, detail: result.kind === 'accepted' ? result.detail : 'invalid_email' })
  } catch (error) {
    if (error instanceof FichaError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('[admin/customers/ficha] Error enviando el link:', error)
    return NextResponse.json({ error: 'No se pudo enviar el link' }, { status: 500 })
  }
}
