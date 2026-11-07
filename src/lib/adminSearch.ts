/**
 * Búsqueda general del panel (Francisco, 20-10-2026): «una barra de búsqueda de todo el
 * sistema en el sidebar para buscar gastos, trabajos, órdenes, etc.». Busca a la vez en
 * reservas (ID, cliente, teléfono, correo, direcciones, empresa, N° de OD y de guía),
 * cotizaciones, clientes, empresas, trabajadores, gastos, gastos de trabajadores y facturas.
 * Cada grupo solo aparece si el perfil ve ese módulo (y ese subpanel, si lo tiene).
 */

import { supabaseAdmin } from '@/lib/supabase'
import { canSeeModule, canSeeSection, type AdminAccess } from '@/lib/adminAccess'
import type { SearchHit, SearchResults } from '@/lib/adminSearchTypes'

const PER_KIND = 6

const money = (n: number | null | undefined) => (typeof n === 'number' ? `$${Math.round(n).toLocaleString('es-CL')}` : null)
const day = (d: string | null | undefined) => (d ? d.slice(0, 10).split('-').reverse().join('-') : null)
const line = (...parts: (string | null | undefined | false)[]) => parts.filter(Boolean).join(' · ')

/**
 * Lo escrito, limpio para un filtro `or` de PostgREST: sin comas, paréntesis, comodines ni
 * comillas, que romperían la consulta o la ampliarían.
 */
export function cleanQuery(raw: unknown): string {
  return String(raw ?? '')
    .replace(/[,()*%_\\"'`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
}

const ilikeAny = (columns: string[], q: string) => columns.map((c) => `${c}.ilike.%${q}%`).join(',')

export async function searchAdmin(rawQuery: unknown, access: AdminAccess): Promise<SearchResults> {
  const q = cleanQuery(rawQuery)
  if (q.length < 2) return { query: q, hits: [] }
  // Montos: columnas INTEGER; un número más grande (un teléfono, un N° largo) rompería la consulta.
  const asNumber = /^\d+$/.test(q.replace(/\./g, '')) ? Number(q.replace(/\./g, '')) : null
  const digits = asNumber !== null && asNumber <= 2_147_483_647 ? asNumber : null
  const sees = (module: Parameters<typeof canSeeModule>[1], section?: string) =>
    canSeeModule(access, module) && (!section || canSeeSection(access, `${module}.${section}`))

  const tasks: Promise<SearchHit[]>[] = []

  if (sees('bookings')) {
    tasks.push(
      (async () => {
        const { data } = await supabaseAdmin
          .from('bookings')
          .select('id, quote_id, code, client_name, client_phone, scheduled_date, status, total_price, adjusted_price, origin_address, destination_address, company_name, od_number, guide_number')
          .or(
            ilikeAny(
              ['quote_id', 'code', 'client_name', 'client_email', 'client_phone', 'origin_address', 'destination_address', 'company_name', 'od_number', 'guide_number'],
              q
            )
          )
          .order('scheduled_date', { ascending: false })
          .limit(PER_KIND)
        return ((data || []) as any[]).map((b) => ({
          kind: 'booking' as const,
          id: b.id,
          title: line(b.client_name || 'Sin nombre', b.code || b.quote_id),
          detail: line(
            day(b.scheduled_date),
            b.status,
            money(b.adjusted_price ?? b.total_price),
            b.od_number && `OD ${b.od_number}`,
            b.guide_number && `guía ${b.guide_number}`,
            [b.origin_address, b.destination_address].filter(Boolean).join(' → ')
          ),
          tab: 'bookings' as const,
          bookingSearch: b.quote_id || b.code || undefined,
        }))
      })()
    )
  }

  if (sees('prospects')) {
    tasks.push(
      (async () => {
        const { data } = await supabaseAdmin
          .from('quote_prospects')
          .select('id, quote_id, code, name, phone, status, total_price, created_at, origin_address, destination_address')
          .or(ilikeAny(['quote_id', 'code', 'name', 'email', 'phone', 'company_name', 'origin_address', 'destination_address'], q))
          .order('created_at', { ascending: false })
          .limit(PER_KIND)
        return ((data || []) as any[]).map((p) => ({
          kind: 'prospect' as const,
          id: p.id,
          title: line(p.name || 'Sin nombre', p.code || p.quote_id),
          detail: line(day(p.created_at), p.status, money(p.total_price), [p.origin_address, p.destination_address].filter(Boolean).join(' → ')),
          tab: 'prospects' as const,
        }))
      })()
    )
  }

  if (sees('customers')) {
    tasks.push(
      (async () => {
        const { data } = await supabaseAdmin
          .from('customers')
          .select('id, code, name, email, phone, company_name')
          .or(ilikeAny(['code', 'name', 'email', 'phone', 'rut', 'company_name'], q))
          .order('updated_at', { ascending: false })
          .limit(PER_KIND)
        return ((data || []) as any[]).map((c) => ({
          kind: 'customer' as const,
          id: c.id,
          title: line(c.name || c.email || 'Sin nombre', c.code),
          detail: line(c.email, c.phone, c.company_name),
          tab: 'customers' as const,
        }))
      })()
    )
  }

  if (sees('companies')) {
    tasks.push(
      (async () => {
        const { data } = await supabaseAdmin
          .from('companies')
          .select('id, code, razon_social, rut, giro')
          .or(ilikeAny(['code', 'razon_social', 'rut', 'giro', 'email_facturacion'], q))
          .order('razon_social')
          .limit(PER_KIND)
        return ((data || []) as any[]).map((c) => ({
          kind: 'company' as const,
          id: c.id,
          title: line(c.razon_social, c.code),
          detail: line(c.rut, c.giro),
          tab: 'companies' as const,
        }))
      })()
    )
  }

  if (sees('fleet')) {
    tasks.push(
      (async () => {
        const { data } = await supabaseAdmin
          .from('workers')
          .select('id, code, name, rut, phone, active')
          .or(ilikeAny(['code', 'name', 'rut', 'phone', 'email'], q))
          .order('name')
          .limit(PER_KIND)
        return ((data || []) as any[]).map((w) => ({
          kind: 'worker' as const,
          id: w.id,
          title: line(w.name, w.code),
          detail: line(w.rut, w.phone, w.active === false && 'inactivo'),
          tab: 'fleet' as const,
        }))
      })()
    )
  }

  if (sees('finance', 'expenses')) {
    tasks.push(
      (async () => {
        const text = ilikeAny(['description', 'category', 'provider', 'doc_number'], q)
        const { data } = await supabaseAdmin
          .from('company_expenses')
          .select('id, expense_date, category, description, amount, provider, doc_number')
          .or(digits !== null ? `${text},amount.eq.${digits}` : text)
          .order('expense_date', { ascending: false })
          .limit(PER_KIND)
        return ((data || []) as any[]).map((e) => ({
          kind: 'expense' as const,
          id: e.id,
          title: line(e.description || e.category || 'Gasto', money(e.amount)),
          detail: line(day(e.expense_date), e.category, e.provider, e.doc_number && `doc ${e.doc_number}`),
          tab: 'finance' as const,
        }))
      })()
    )
  }

  if (sees('approvals', 'expenses')) {
    tasks.push(
      (async () => {
        const text = ilikeAny(['note', 'uploaded_by_label', 'file_name'], q)
        const { data } = await supabaseAdmin
          .from('documents')
          .select('id, note, amount, uploaded_by_label, created_at, expense_status')
          .eq('kind', 'gasto')
          .eq('uploaded_by_type', 'trabajador')
          .or(digits !== null ? `${text},amount.eq.${digits}` : text)
          .order('created_at', { ascending: false })
          .limit(PER_KIND)
        return ((data || []) as any[]).map((d) => ({
          kind: 'worker_expense' as const,
          id: d.id,
          title: line(d.note || 'Gasto', money(d.amount)),
          detail: line(day(d.created_at), d.uploaded_by_label, d.expense_status || 'pendiente'),
          tab: 'approvals' as const,
        }))
      })()
    )
  }

  if (sees('invoicing')) {
    tasks.push(
      (async () => {
        const { data: companies } = await supabaseAdmin
          .from('companies')
          .select('id, razon_social')
          .or(ilikeAny(['razon_social', 'rut', 'code'], q))
          .limit(20)
        const companyIds = ((companies || []) as { id: string }[]).map((c) => c.id)
        const filters = [`folio.ilike.%${q}%`, `period.ilike.%${q}%`]
        if (companyIds.length > 0) filters.push(`company_id.in.(${companyIds.join(',')})`)
        const { data } = await supabaseAdmin
          .from('invoices')
          .select('id, company_id, period, status, folio, total, fecha_emision, company:companies(razon_social)')
          .or(filters.join(','))
          .order('created_at', { ascending: false })
          .limit(PER_KIND)
        return ((data || []) as any[]).map((i) => {
          const company = Array.isArray(i.company) ? i.company[0] : i.company
          return {
            kind: 'invoice' as const,
            id: i.id,
            title: line(company?.razon_social || 'Factura', i.folio ? `folio ${i.folio}` : null),
            detail: line(i.period, i.status, money(i.total), day(i.fecha_emision)),
            tab: 'invoicing' as const,
          }
        })
      })()
    )
  }

  // Un grupo que falla (tabla que aún no existe, columna distinta) no tumba a los demás.
  const settled = await Promise.allSettled(tasks)
  const hits = settled.flatMap((r) => {
    if (r.status === 'fulfilled') return r.value
    console.error('[adminSearch] Error en un grupo:', r.reason)
    return []
  })
  return { query: q, hits }
}
