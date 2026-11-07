/**
 * Empresas cliente (etapa 2 del panel de perfiles), para el admin.
 *
 * La empresa es el ID al que se le factura el mes. Dos vínculos, y son distintos a
 * propósito:
 *   - customers.company_id  → QUIÉN pertenece a la empresa (y con qué rol ve el panel).
 *   - bookings.company_id   → QUÉ servicios se le facturan a la empresa.
 * Desde el 20-10-2026 (add_empresa_auto_asignar.sql) la base asigna sola a la empresa las
 * reservas de sus personas y las que traen su RUT: al crearlas y al asociar a la persona.
 * Una reserva se puede seguir asignando o quitando a mano desde la ficha de la empresa.
 */

import { supabaseAdmin } from '@/lib/supabase'
import { isValidRut, normalizeRut } from '@/lib/rut'
import { servicePrice } from '@/lib/revenueBreakdown'
import { DOCUMENT_FIELDS, type StoredDocument } from '@/lib/documents'

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type CompanyRole = 'encargado' | 'miembro'

export interface Company {
  id: string
  code: string
  razon_social: string
  rut: string
  giro: string | null
  direccion: string | null
  comuna: string | null
  ciudad: string | null
  email_facturacion: string | null
  facturacion_mensual: boolean
  notes: string | null
  created_at: string
}

export const COMPANY_FIELDS =
  'id, code, razon_social, rut, giro, direccion, comuna, ciudad, email_facturacion, facturacion_mensual, notes, created_at'

export interface CompanyMember {
  id: string
  code: string
  name: string | null
  email: string
  phone: string | null
  role: CompanyRole
}

export interface CompanyBooking {
  id: string
  code: string | null
  scheduledDate: string | null
  status: string | null
  clientName: string | null
  customerId: string | null
  price: number
  /** La reserva se hizo declarando este mismo RUT de empresa. */
  rutMatches: boolean
}

export class CompanyError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message)
    this.name = 'CompanyError'
  }
}

const text = (value: unknown, max = 200): string | null => {
  const s = typeof value === 'string' ? value.trim().slice(0, max) : ''
  return s || null
}

/** Campos editables de una empresa, validados. `partial` = solo los que vienen (PATCH). */
export function parseCompanyInput(body: any, partial = false): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const has = (key: string) => !partial || body?.[key] !== undefined

  if (has('razon_social')) {
    const razon = text(body?.razon_social)
    if (!razon) throw new CompanyError('Falta la razón social.')
    out.razon_social = razon
  }
  if (has('rut')) {
    if (!isValidRut(body?.rut)) throw new CompanyError('El RUT no es válido. Revisa el dígito verificador.')
    out.rut = normalizeRut(body.rut)
  }
  if (has('email_facturacion')) {
    const email = text(body?.email_facturacion)?.toLowerCase() || null
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new CompanyError('El correo de facturación no es válido.')
    }
    out.email_facturacion = email
  }
  for (const key of ['giro', 'direccion', 'comuna', 'ciudad']) if (has(key)) out[key] = text(body?.[key])
  if (has('notes')) out.notes = text(body?.notes, 2000)
  if (has('facturacion_mensual')) out.facturacion_mensual = body?.facturacion_mensual !== false
  return out
}

/** Todas las empresas con cuántas personas y reservas tienen. */
export async function listCompanies() {
  const [companies, members, bookings] = await Promise.all([
    supabaseAdmin.from('companies').select(COMPANY_FIELDS).order('razon_social'),
    supabaseAdmin.from('customers').select('company_id').not('company_id', 'is', null),
    supabaseAdmin.from('bookings').select('company_id').not('company_id', 'is', null),
  ])
  if (companies.error) throw companies.error
  const count = (rows: { company_id: string | null }[] | null) => {
    const map = new Map<string, number>()
    for (const r of rows || []) if (r.company_id) map.set(r.company_id, (map.get(r.company_id) || 0) + 1)
    return map
  }
  const memberCount = count(members.data)
  const bookingCount = count(bookings.data)
  return ((companies.data || []) as Company[]).map((c) => ({
    ...c,
    memberCount: memberCount.get(c.id) || 0,
    bookingCount: bookingCount.get(c.id) || 0,
  }))
}

const BOOKING_FIELDS =
  'id, code, scheduled_date, status, client_name, customer_id, company_id, company_rut, total_price, original_price, adjusted_price'

function toCompanyBooking(b: any, companyRut: string): CompanyBooking {
  return {
    id: b.id,
    code: b.code,
    scheduledDate: b.scheduled_date,
    status: b.status,
    clientName: b.client_name,
    customerId: b.customer_id,
    price: servicePrice(b),
    rutMatches: !!b.company_rut && normalizeRut(b.company_rut) === companyRut,
  }
}

/** Ficha de una empresa: datos, personas, reservas asignadas, reservas por asignar y documentos. */
export async function getCompanyDetail(companyId: string) {
  if (!UUID_RE.test(companyId)) return null
  const { data: company } = await supabaseAdmin.from('companies').select(COMPANY_FIELDS).eq('id', companyId).maybeSingle()
  if (!company) return null

  const [membersResult, assignedResult, ownDocumentsResult] = await Promise.all([
    supabaseAdmin
      .from('customers')
      .select('id, code, name, email, phone, company_role')
      .eq('company_id', companyId)
      .order('name'),
    supabaseAdmin
      .from('bookings')
      .select(BOOKING_FIELDS)
      .eq('company_id', companyId)
      .order('scheduled_date', { ascending: false })
      .limit(500),
    supabaseAdmin
      .from('documents')
      .select(DOCUMENT_FIELDS)
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(200),
  ])

  // Fotos y documentos de sus reservas (los que sube el equipo en terreno o el cliente a una
  // reserva quedan en la reserva, no en la empresa): antes no se veían desde Empresas.
  const assignedRows = (assignedResult.data || []) as { id: string; code?: string | null; quote_id?: string | null }[]
  const codeByBooking = new Map(assignedRows.map((b) => [b.id, b.code || b.quote_id || null]))
  const bookingDocuments: StoredDocument[] = []
  const ids = assignedRows.map((b) => b.id)
  for (let i = 0; i < ids.length; i += 100) {
    const { data } = await supabaseAdmin
      .from('documents')
      .select(DOCUMENT_FIELDS)
      .in('booking_id', ids.slice(i, i + 100))
      .order('created_at', { ascending: false })
      .limit(300)
    bookingDocuments.push(...((data || []) as StoredDocument[]))
  }
  const seen = new Set<string>()
  const documents = [...((ownDocumentsResult.data || []) as StoredDocument[]), ...bookingDocuments]
    .filter((d) => (seen.has(d.id) ? false : (seen.add(d.id), true)))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map((d) => ({ ...d, context: d.booking_id ? codeByBooking.get(d.booking_id) || null : null }))

  const members: CompanyMember[] = (membersResult.data || []).map((m) => ({
    id: m.id,
    code: m.code,
    name: m.name,
    email: m.email,
    phone: m.phone,
    role: m.company_role === 'encargado' ? 'encargado' : 'miembro',
  }))

  // Por asignar: reservas de las personas de la empresa que todavía no son de ninguna.
  let candidates: CompanyBooking[] = []
  if (members.length > 0) {
    const { data } = await supabaseAdmin
      .from('bookings')
      .select(BOOKING_FIELDS)
      .in('customer_id', members.map((m) => m.id))
      .is('company_id', null)
      .neq('status', 'cancelled')
      .order('scheduled_date', { ascending: false })
      .limit(200)
    candidates = (data || []).map((b) => toCompanyBooking(b, company.rut))
  }

  return {
    company: company as Company,
    members,
    bookings: (assignedResult.data || []).map((b) => toCompanyBooking(b, company.rut)),
    candidates,
    documents,
  }
}

/**
 * Reserva marcada «es empresa» al reservar que no está asignada a ninguna empresa del panel
 * (Tomás, 20-10-2026: la RES-000331 «no aparece en Empresas y no se puede facturar»). La
 * factura sale por empresa, así que mientras no tenga una no se puede facturar.
 */
export interface UnlinkedCompanyBooking {
  id: string
  code: string | null
  scheduledDate: string | null
  status: string | null
  clientName: string | null
  /** Lo que escribió al reservar como empresa. */
  typedName: string | null
  typedRut: string | null
  /** La empresa que figura en la ficha del cliente, si tiene. */
  profileName: string | null
  profileRut: string | null
}

export async function listUnlinkedCompanyBookings(): Promise<UnlinkedCompanyBooking[]> {
  const { data, error } = await supabaseAdmin
    .from('bookings')
    .select('id, code, quote_id, scheduled_date, status, client_name, company_name, company_rut, customer_id, is_provisional')
    .eq('is_company', true)
    .is('company_id', null)
    .neq('status', 'cancelled')
    .order('scheduled_date', { ascending: false })
    .limit(200)
  if (error) throw error
  const rows = ((data || []) as any[]).filter((b) => !b.is_provisional && !String(b.quote_id || '').startsWith('ADMIN-BLOQUEO-'))
  const customerIds = Array.from(new Set(rows.map((b) => b.customer_id).filter(Boolean)))
  const { data: customers } = customerIds.length
    ? await supabaseAdmin.from('customers').select('id, company_name, company_rut').in('id', customerIds)
    : { data: [] as any[] }
  const byId = new Map(((customers || []) as any[]).map((c) => [c.id, c]))
  return rows.map((b) => {
    const c = b.customer_id ? byId.get(b.customer_id) : null
    return {
      id: b.id,
      code: b.code || b.quote_id || null,
      scheduledDate: b.scheduled_date,
      status: b.status,
      clientName: b.client_name,
      typedName: b.company_name || null,
      typedRut: b.company_rut || null,
      profileName: c?.company_name || null,
      profileRut: c?.company_rut || null,
    }
  })
}

/** Asigna a una empresa una reserva marcada «es empresa» que no tenía ninguna. */
export async function assignUnlinkedBooking(bookingId: unknown, companyId: unknown): Promise<{ booking: string; company: string }> {
  if (typeof bookingId !== 'string' || !UUID_RE.test(bookingId) || typeof companyId !== 'string' || !UUID_RE.test(companyId)) {
    throw new CompanyError('Reserva o empresa no encontrada', 404)
  }
  const { data: company } = await supabaseAdmin.from('companies').select('id, code, razon_social').eq('id', companyId).maybeSingle()
  if (!company) throw new CompanyError('Empresa no encontrada', 404)
  const { data, error } = await supabaseAdmin
    .from('bookings')
    .update({ company_id: company.id })
    .eq('id', bookingId)
    .eq('is_company', true)
    .is('company_id', null)
    .select('code, quote_id')
    .maybeSingle()
  if (error) throw error
  if (!data) throw new CompanyError('Esa reserva ya tiene empresa o no está marcada como empresa.', 409)
  return { booking: data.code || data.quote_id || bookingId, company: `${company.razon_social} (${company.code})` }
}
