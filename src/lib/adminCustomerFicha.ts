/**
 * Ficha del cliente para el admin (rediseño, fase 3): todo lo de una persona en un solo
 * lugar — sus datos y su acceso, su empresa, sus reservas, cotizaciones, solicitudes,
 * documentos y beneficios. No guarda nada nuevo: junta lo que ya existe.
 *
 * La lista de Clientes del admin se arma por correo (reservas + cotizaciones); la cuenta
 * vive en `customers`. El puente es el correo.
 */

import { isValidEmail } from '@/lib/emailFormat'
import { supabaseAdmin } from '@/lib/supabase'
import { getCustomerAccount, getCustomerCompany } from '@/lib/customerAccount'
import { listCustomerRequests } from '@/lib/serviceRequests'
import { getCustomerBenefits } from '@/lib/coupons'
import { DOCUMENT_FIELDS } from '@/lib/documents'
import { actualPaidAmount, pendingAmount, servicePrice } from '@/lib/revenueBreakdown'
import { SERVICE_TYPE_LABEL } from '@/lib/serviceRequestTypes'
import { isValidRut, normalizeRut } from '@/lib/rut'
import type { CustomerFicha } from '@/lib/customerFichaTypes'

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export class FichaError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message)
    this.name = 'FichaError'
  }
}

/** La ficha de quien tiene este correo, o null si todavía no tiene cuenta de cliente. */
export async function getCustomerFicha(rawEmail: unknown): Promise<CustomerFicha | null> {
  const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : ''
  // Sin exigir «@»: hay fichas creadas desde reservas a mano donde en el campo del correo se
  // escribió otra cosa (un nombre, «sin correo»). Esas fichas existen y hay que poder
  // abrirlas, justamente para corregirles el correo.
  if (!email) return null

  // `*` a propósito: las columnas de cuenta (rut, password_hash…) no existen hasta correr
  // add_customer_accounts.sql, y pedirlas por nombre haría fallar toda la ficha.
  const { data: row } = await supabaseAdmin.from('customers').select('*').eq('email', email).maybeSingle()
  if (!row) return null
  const accountsAvailable = 'password_hash' in row

  const [account, company, requests, benefits, bookingsResult] = await Promise.all([
    getCustomerAccount(row.id),
    getCustomerCompany(row.id),
    listCustomerRequests(row.id),
    getCustomerBenefits(row.id),
    supabaseAdmin
      .from('bookings')
      .select(
        'id, code, quote_id, scheduled_date, status, is_provisional, total_price, original_price, adjusted_price, amount_paid, payment_type, payment_status'
      )
      .eq('customer_id', row.id)
      .order('scheduled_date', { ascending: false })
      .limit(100),
  ])

  // Reservas reales: fuera los bloqueos de agenda y las pre-reservas que nunca se pagaron.
  const bookings = (bookingsResult.data || []).filter(
    (b: any) => !String(b.quote_id || '').startsWith('ADMIN-BLOQUEO-') && !(b.is_provisional && b.payment_status !== 'approved')
  )

  // Documentos: lo que subió la persona y todo lo de sus reservas (también lo del equipo).
  const filters = [`customer_id.eq.${row.id}`]
  if (bookings.length > 0) filters.push(`booking_id.in.(${bookings.map((b: any) => b.id).join(',')})`)
  const { data: documents } = await supabaseAdmin
    .from('documents')
    .select(DOCUMENT_FIELDS)
    .or(filters.join(','))
    .order('created_at', { ascending: false })
    .limit(100)
  const codeByBooking = new Map(bookings.map((b: any) => [b.id, b.code]))

  return {
    customer: {
      id: row.id,
      code: row.code,
      name: row.name,
      email: row.email,
      phone: row.phone,
      rut: row.rut || null,
      rutDeclared: row.rut_declared || null,
      hasPassword: Boolean(row.password_hash),
      passwordSetAt: row.password_set_at || null,
      accountsAvailable,
      createdAt: row.created_at,
    },
    company: company ? { id: company.id, code: company.code, razon_social: company.razon_social, role: company.role } : null,
    bookings: bookings.map((b: any) => ({
      id: b.id,
      code: b.code,
      quoteId: b.quote_id,
      scheduledDate: b.scheduled_date,
      status: b.status,
      price: servicePrice(b),
      paid: actualPaidAmount(b),
      pending: pendingAmount(b),
    })),
    quotes: (account?.quotes || []).map((q) => ({
      id: q.id,
      code: q.code,
      value: q.value,
      scheduledDate: q.scheduledDate,
      isOutstanding: q.isOutstanding,
    })),
    requests: requests.requests
      .filter((r) => r.customer.id === row.id)
      .map((r) => ({
        id: r.id,
        code: r.code,
        label: `${SERVICE_TYPE_LABEL[r.serviceType]} · ${r.origin} → ${r.destination}`,
        status: r.status,
        createdAt: r.createdAt,
      })),
    documents: ((documents || []) as any[]).map((d) => ({
      ...d,
      context: d.booking_id && codeByBooking.get(d.booking_id) ? `Reserva ${codeByBooking.get(d.booking_id)}` : null,
    })),
    benefits: {
      referralCode: benefits.referralCode,
      referredCount: benefits.referredCount,
      completedCount: benefits.completedCount,
      prizes: benefits.prizes.map((p) => ({ code: p.code, label: p.label, state: p.state })),
    },
  }
}

async function loadCustomer(customerId: unknown) {
  if (typeof customerId !== 'string' || !UUID_RE.test(customerId)) throw new FichaError('Cliente no encontrado', 404)
  const { data } = await supabaseAdmin.from('customers').select('*').eq('id', customerId).maybeSingle()
  if (!data) throw new FichaError('Cliente no encontrado', 404)
  if (!('password_hash' in data)) throw new FichaError('Falta correr la migración add_customer_accounts.sql.', 503)
  return data
}

/**
 * Cambios de acceso desde la ficha. Devuelve un resumen para el registro de Actividad.
 *   set_rut          -> carga o corrige el RUT confirmado (vacío lo quita).
 *   confirm_declared -> da por bueno el RUT que la persona escribió en el cotizador.
 *   reset_password   -> borra la clave: vuelve a poder entrar «por primera vez» con su RUT.
 *   set_data         -> corrige nombre y teléfono.
 *   set_email        -> cambia el correo. Es la identidad de la persona (con él entra a su
 *                       cuenta y se enlazan sus reservas), así que también se cambia en sus
 *                       reservas y cotizaciones, y no puede ser el de otra ficha.
 */
export async function updateCustomerAccess(
  customerId: unknown,
  action: unknown,
  rawRut: unknown,
  rawData?: { name?: unknown; phone?: unknown; email?: unknown }
): Promise<{ label: string; summary: string; changes: Record<string, { from: unknown; to: unknown }> }> {
  const customer = await loadCustomer(customerId)
  const label = `${customer.name || customer.email} (${customer.code})`
  const save = async (values: Record<string, unknown>) => {
    const { error } = await supabaseAdmin.from('customers').update({ ...values, updated_at: new Date().toISOString() }).eq('id', customer.id)
    if (error) throw error
  }

  if (action === 'set_rut') {
    const text = typeof rawRut === 'string' ? rawRut.trim() : ''
    if (text && !isValidRut(text)) throw new FichaError('El RUT no es válido. Revisa el dígito verificador.')
    const rut = text ? normalizeRut(text) : null
    await save({ rut })
    return { label, summary: rut ? `Cargó el RUT de ${label}` : `Quitó el RUT de ${label}`, changes: { rut: { from: customer.rut ?? null, to: rut } } }
  }
  if (action === 'set_data') {
    const name = typeof rawData?.name === 'string' ? rawData.name.trim().slice(0, 120) : ''
    const phone = typeof rawData?.phone === 'string' ? rawData.phone.trim().slice(0, 30) : ''
    if (!name) throw new FichaError('Falta el nombre.')
    const changes: Record<string, { from: unknown; to: unknown }> = {}
    if (name !== (customer.name || '')) changes.name = { from: customer.name ?? null, to: name }
    if (phone !== (customer.phone || '')) changes.phone = { from: customer.phone ?? null, to: phone || null }
    if (Object.keys(changes).length === 0) throw new FichaError('No hay cambios que guardar.')
    await save({ name, phone: phone || null })
    return { label, summary: `Editó los datos de ${label}`, changes }
  }
  if (action === 'set_email') {
    const email = typeof rawData?.email === 'string' ? rawData.email.trim().toLowerCase() : ''
    if (!isValidEmail(email)) throw new FichaError('Ese correo no es válido.')
    const previous = String(customer.email || '')
    if (email === previous.toLowerCase()) throw new FichaError('Es el mismo correo que ya tiene.')
    const { data: taken } = await supabaseAdmin.from('customers').select('id, code').eq('email', email).maybeSingle()
    if (taken && taken.id !== customer.id) {
      throw new FichaError(`Ya existe otra ficha con ese correo (${taken.code}). No se pueden unir dos fichas desde aquí.`, 409)
    }
    // Primero la ficha: el enlace de reservas y cotizaciones a su cliente es por correo, así
    // que al cambiarles el correo después siguen apuntando a esta misma persona.
    await save({ email })
    const stamp = new Date().toISOString()
    const { error: bookingsError } = await supabaseAdmin.from('bookings').update({ client_email: email }).eq('customer_id', customer.id)
    const { error: prospectsError } = await supabaseAdmin
      .from('quote_prospects')
      .update({ email, updated_at: stamp })
      .eq('customer_id', customer.id)
    if (bookingsError || prospectsError) {
      console.error('[adminCustomerFicha] El correo cambió en la ficha pero no en todo lo suyo:', bookingsError?.message, prospectsError?.message)
      throw new FichaError('El correo se guardó en la ficha, pero no en todas sus reservas o cotizaciones. Avísale a soporte.', 500)
    }
    return { label: `${customer.name || email} (${customer.code})`, summary: `Cambió el correo de ${label}`, changes: { email: { from: previous, to: email } } }
  }
  if (action === 'confirm_declared') {
    if (!customer.rut_declared || !isValidRut(customer.rut_declared)) throw new FichaError('Esta persona no tiene un RUT declarado para confirmar.')
    const rut = normalizeRut(customer.rut_declared)
    await save({ rut })
    return { label, summary: `Confirmó el RUT declarado de ${label}`, changes: { rut: { from: customer.rut ?? null, to: rut } } }
  }
  if (action === 'reset_password') {
    if (!customer.password_hash) throw new FichaError('Esta persona todavía no tiene clave.')
    await save({ password_hash: null, password_set_at: null })
    // Nunca se registra la clave ni su hash: solo el hecho.
    return { label, summary: `Borró la clave de acceso de ${label}`, changes: { clave: { from: 'creada', to: 'sin clave' } } }
  }
  throw new FichaError('Acción no reconocida.')
}

/** Correo de un cliente por id, para mandarle el link de acceso. */
export async function customerEmailById(customerId: unknown): Promise<{ email: string; label: string }> {
  if (typeof customerId !== 'string' || !UUID_RE.test(customerId)) throw new FichaError('Cliente no encontrado', 404)
  const { data } = await supabaseAdmin.from('customers').select('email, name, code').eq('id', customerId).maybeSingle()
  if (!data) throw new FichaError('Cliente no encontrado', 404)
  return { email: data.email, label: `${data.name || data.email} (${data.code})` }
}
