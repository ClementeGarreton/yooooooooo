/**
 * Panel de una empresa en el admin (Francisco, 27-10-2026): al hacer click en una empresa se
 * abre un panel completo con sus trabajos (y quién los hizo), sus facturas, sus cierres, sus
 * documentos y un historial de notas. Las empresas como Monfiza piden muchos servicios y
 * buscarlos por separado en Reservas, Trabajos y Facturación no escala.
 *
 * Esto arma lo que no estaba en la ficha: trabajos con su cuadrilla y archivos, facturas de
 * todos los meses, último cierre y notas (company_notes, add_notas_empresa.sql). Datos,
 * personas y documentos siguen saliendo de `getCompanyDetail` (companies.ts).
 */

import { supabaseAdmin } from '@/lib/supabase'
import { fetchAllRows } from '@/lib/server/fetchAllRows'
import { UUID_RE } from '@/lib/companies'
import { servicePrice } from '@/lib/revenueBreakdown'
import { customerFromNotes } from '@/lib/companyClosingTypes'
import type { InvoiceStatus } from '@/lib/invoiceTypes'

export class CompanyPanelError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message)
    this.name = 'CompanyPanelError'
  }
}

export interface CompanyJob {
  id: string
  code: string | null
  date: string | null
  status: string | null
  /** Quién pidió el servicio (nombre de la reserva). */
  clientName: string | null
  /** Cliente final de la entrega, leído de las notas («CLIENTE: …»). */
  customer: string | null
  workers: { id: string; name: string }[]
  /** Fotos y documentos subidos a la reserva. */
  files: number
  price: number
  /** Neto en UF puesto por el cierre, si la empresa se cierra en UF. */
  priceUf: number | null
  /** Está en una factura emitida (o emitiéndose, o con resultado por confirmar). */
  invoiced: boolean
}

export interface CompanyInvoice {
  id: string
  period: string
  status: InvoiceStatus
  folio: string | null
  fechaEmision: string | null
  neto: number | null
  iva: number | null
  total: number | null
  createdAt: string
}

export interface CompanyNote {
  id: string
  body: string
  author: string | null
  authorName: string | null
  createdAt: string
}

export interface CompanyPanelData {
  /** La empresa se cierra por pallets o kilos (como Monfiza): se cobra con el cierre. */
  closesByUnit: boolean
  jobs: CompanyJob[]
  invoices: CompanyInvoice[]
  /** Cierres guardados vigentes (no reabiertos), del más nuevo al más viejo. */
  closings: { id: string; from: string; to: string; totalClp: number; closedBy: string | null; closedAt: string }[]
  notes: CompanyNote[]
  /** false = falta correr add_notas_empresa.sql. */
  notesAvailable: boolean
}

// Tabla que todavía no existe (falta la migración): Postgres 42P01, PostgREST PGRST205.
const missingTable = (error: { code?: string } | null) => error?.code === '42P01' || error?.code === 'PGRST205'

async function inChunks<T>(ids: string[], fetch: (chunk: string[]) => PromiseLike<{ data: T[] | null }>): Promise<T[]> {
  const out: T[] = []
  for (let i = 0; i < ids.length; i += 100) out.push(...(((await fetch(ids.slice(i, i + 100))).data || []) as T[]))
  return out
}

export async function getCompanyPanel(companyId: string): Promise<CompanyPanelData> {
  if (!UUID_RE.test(companyId)) throw new CompanyPanelError('Empresa no encontrada', 404)

  const [companyResult, bookingsResult, invoicesResult, closingsResult, notesResult] = await Promise.all([
    supabaseAdmin.from('companies').select('*').eq('id', companyId).maybeSingle(),
    // `fetchAllRows`: con `.limit(2000)` el corte real eran 1000 reservas (`max-rows`
    // de PostgREST); el panel de una empresa activa dejaba de ver las más antiguas
    // sin avisar. Orden estable con desempate por `id`.
    fetchAllRows<any>((from, to) =>
      supabaseAdmin
        .from('bookings')
        .select('*')
        .eq('company_id', companyId)
        .order('scheduled_date', { ascending: false })
        .order('id', { ascending: false })
        .range(from, to)
    ),
    supabaseAdmin
      .from('invoices')
      .select('id, period, status, folio, fecha_emision, neto, iva, total, created_at')
      .eq('company_id', companyId)
      // Las vistas previas y los intentos que no se emitieron no son facturas.
      .not('status', 'in', '(previsualizada,fallida)')
      .order('created_at', { ascending: false })
      .limit(200),
    supabaseAdmin
      .from('company_closings')
      .select('id, period_from, period_to, total_clp, closed_by, closed_at, reopened_at')
      .eq('company_id', companyId)
      .is('reopened_at', null)
      .order('period_to', { ascending: false })
      .limit(100),
    supabaseAdmin
      .from('company_notes')
      .select('id, body, author, author_name, created_at')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(500),
  ])
  if (!companyResult.data) throw new CompanyPanelError('Empresa no encontrada', 404)
  if (bookingsResult.error) throw new CompanyPanelError('No se pudieron leer los trabajos de la empresa.', 500)

  const bookings = ((bookingsResult.data || []) as any[]).filter((b) => !b.is_provisional)
  const ids = bookings.map((b) => b.id)
  const [crew, files, invoiceLinks] = await Promise.all([
    inChunks<{ booking_id: string; worker_id: string }>(ids, (chunk) =>
      supabaseAdmin.from('booking_workers').select('booking_id, worker_id').in('booking_id', chunk)
    ),
    inChunks<{ booking_id: string }>(ids, (chunk) =>
      supabaseAdmin.from('documents').select('booking_id').in('kind', ['foto', 'documento']).in('booking_id', chunk)
    ),
    inChunks<{ booking_id: string; invoices: { status: string } | { status: string }[] | null }>(ids, (chunk) =>
      supabaseAdmin.from('invoice_bookings').select('booking_id, invoices(status)').in('booking_id', chunk)
    ),
  ])
  // Mismo criterio que el cierre (invoicedBookingIds): emitida, emitiéndose o por confirmar.
  const invoiced = new Set(
    invoiceLinks
      .filter((l) => {
        const inv = Array.isArray(l.invoices) ? l.invoices[0] : l.invoices
        return inv && ['emitida', 'emitiendo', 'desconocido'].includes(inv.status)
      })
      .map((l) => l.booking_id)
  )
  const workerIds = Array.from(new Set(crew.map((c) => c.worker_id)))
  const workers = await inChunks<{ id: string; name: string | null }>(workerIds, (chunk) =>
    supabaseAdmin.from('workers').select('id, name').in('id', chunk)
  )
  const workerName = new Map(workers.map((w) => [w.id, w.name || 'Sin nombre']))
  const crewByBooking = new Map<string, { id: string; name: string }[]>()
  for (const c of crew) {
    crewByBooking.set(c.booking_id, [...(crewByBooking.get(c.booking_id) || []), { id: c.worker_id, name: workerName.get(c.worker_id) || 'Sin nombre' }])
  }
  const filesByBooking = new Map<string, number>()
  for (const f of files) filesByBooking.set(f.booking_id, (filesByBooking.get(f.booking_id) || 0) + 1)

  const jobs: CompanyJob[] = bookings.map((b) => ({
    id: b.id,
    code: b.code || b.quote_id || null,
    date: b.scheduled_date || null,
    status: b.status || null,
    clientName: b.client_name || null,
    customer: customerFromNotes(b.notes),
    workers: (crewByBooking.get(b.id) || []).sort((x, y) => x.name.localeCompare(y.name)),
    files: filesByBooking.get(b.id) || 0,
    price: servicePrice(b),
    priceUf: b.price_uf === null || b.price_uf === undefined ? null : Number(b.price_uf),
    invoiced: invoiced.has(b.id),
  }))

  const closingUnit = (companyResult.data as any).closing_unit
  return {
    closesByUnit: closingUnit === 'pallets' || closingUnit === 'kg',
    jobs,
    // Sin la tabla de facturas o de cierres (migraciones viejas), esas listas quedan vacías.
    invoices: ((invoicesResult.data || []) as any[]).map((i) => ({
      id: i.id,
      period: i.period,
      status: i.status,
      folio: i.folio ?? null,
      fechaEmision: i.fecha_emision ?? null,
      neto: i.neto === null ? null : Number(i.neto),
      iva: i.iva === null ? null : Number(i.iva),
      total: i.total === null ? null : Number(i.total),
      createdAt: i.created_at,
    })),
    closings: ((closingsResult.data || []) as any[]).map((c) => ({
      id: c.id,
      from: c.period_from,
      to: c.period_to,
      totalClp: Number(c.total_clp) || 0,
      closedBy: c.closed_by ?? null,
      closedAt: c.closed_at,
    })),
    notes: ((notesResult.data || []) as any[]).map((n) => ({
      id: n.id,
      body: n.body,
      author: n.author ?? null,
      authorName: n.author_name ?? null,
      createdAt: n.created_at,
    })),
    notesAvailable: !missingTable(notesResult.error),
  }
}

/** Agrega una nota al historial de la empresa. Las notas no se editan. */
export async function addCompanyNote(companyId: string, rawBody: unknown, author: string | null): Promise<{ companyName: string; note: CompanyNote }> {
  if (!UUID_RE.test(companyId)) throw new CompanyPanelError('Empresa no encontrada', 404)
  const body = typeof rawBody === 'string' ? rawBody.trim() : ''
  if (!body) throw new CompanyPanelError('Escribe la nota.')
  if (body.length > 2000) throw new CompanyPanelError('La nota es demasiado larga (hasta 2.000 caracteres).')

  const { data: company } = await supabaseAdmin.from('companies').select('id, razon_social').eq('id', companyId).maybeSingle()
  if (!company) throw new CompanyPanelError('Empresa no encontrada', 404)

  // El nombre a la vista de quien escribe («Tomás»), además del usuario.
  let authorName: string | null = null
  if (author) {
    const { data: user } = await supabaseAdmin.from('admin_users').select('display_name').eq('username', author).maybeSingle()
    authorName = user?.display_name || null
  }

  const { data, error } = await supabaseAdmin
    .from('company_notes')
    .insert({ company_id: companyId, body, author, author_name: authorName })
    .select('id, body, author, author_name, created_at')
    .single()
  if (error || !data) {
    if (missingTable(error)) throw new CompanyPanelError('Falta correr la migración add_notas_empresa.sql.', 409)
    throw new CompanyPanelError('No se pudo guardar la nota.', 500)
  }
  return {
    companyName: company.razon_social,
    note: { id: data.id, body: data.body, author: data.author, authorName: data.author_name, createdAt: data.created_at },
  }
}
