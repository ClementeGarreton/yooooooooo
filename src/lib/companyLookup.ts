/**
 * Datos de una empresa que el sistema ya tiene, por su RUT (Tomás, 23-10-2026: al crear la
 * empresa «sigue sin compatibilizar con los datos que ya manejamos»). Sirve para llenar el
 * formulario de «Nueva empresa» en vez de tipear todo:
 *  - SII (Emisso): la última factura que Yo Me Encargo le emitió a ese RUT trae razón social,
 *    giro, dirección y comuna tal como se facturó.
 *  - Panel: el nombre de empresa y el correo con que reservó o cotizó con ese RUT.
 * Solo lectura. Lo que no se encuentra queda vacío.
 */

import { supabaseAdmin } from '@/lib/supabase'
import { callEmisso } from '@/lib/emisso'
import { isValidRut, normalizeRut } from '@/lib/rut'

export interface CompanyLookup {
  razonSocial: string | null
  giro: string | null
  direccion: string | null
  comuna: string | null
  email: string | null
  /** De dónde salió cada cosa, para mostrarlo. */
  sources: string[]
}

const key = (rut: string) => rut.toUpperCase().replace(/[^0-9K]/g, '').replace(/^0+/, '')

/** La última factura emitida a ese RUT que el SII tiene respaldada (con su detalle). */
async function fromSii(rut: string): Promise<Partial<CompanyLookup> & { source?: string }> {
  const wanted = key(rut)
  let cursor: string | undefined
  let last: any = null
  for (let page = 0; page < 10; page++) {
    const res = await callEmisso<any>('sii.documentos.consultar', { perspectiva: 'emitidos', limit: 500, ...(cursor ? { cursor } : {}) }, { timeoutMs: 20_000 })
    if (!res.ok) return {}
    const docs = ((res.data as any)?.documentos || []) as any[]
    for (const d of docs) {
      if (key(String(d.rutReceptor || '')) !== wanted || ![33, 34].includes(Number(d.tipoDte))) continue
      if (!last || String(d.fechaEmision || '') > String(last.fechaEmision || '')) last = d
    }
    cursor = (res.data as any)?.cursor || undefined
    if (!cursor) break
  }
  if (!last) return {}
  const det = await callEmisso<any>('sii.documentos.detallar', { tipoDte: last.tipoDte, folio: last.folio, rutEmisor: last.rutEmisor }, { timeoutMs: 20_000 })
  const d = det.ok ? (det.data as any)?.documento?.detalle : null
  return {
    razonSocial: d?.razonSocialReceptor || last.razonSocialContraparte || null,
    giro: d?.giroReceptor || null,
    direccion: d?.dirReceptor || null,
    comuna: d?.cmnaReceptor || null,
    source: `factura N° ${last.folio} del ${String(last.fechaEmision || '').split('-').reverse().join('-')} (SII)`,
  }
}

/** Nombre de empresa y correo con que reservó o cotizó con ese RUT. */
async function fromPanel(rut: string): Promise<Partial<CompanyLookup> & { source?: string }> {
  // Las reservas guardan el RUT como lo escribió el cliente: se prueban las formas comunes,
  // armadas desde el RUT normalizado (nunca desde el texto crudo, que va dentro del filtro).
  const plain = normalizeRut(rut)
  const [body, dv] = plain.split('-')
  const dotted = body.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  const variants = Array.from(new Set([plain, `${dotted}-${dv}`, `${body}${dv}`, `${dotted}${dv}`]))
  const or = variants.map((v) => `company_rut.eq.${v}`).join(',')
  const [{ data: bookings }, { data: customers }] = await Promise.all([
    supabaseAdmin.from('bookings').select('code, company_name, client_email, created_at').or(or).order('created_at', { ascending: false }).limit(5),
    supabaseAdmin.from('customers').select('code, company_name, email').or(or).limit(5),
  ])
  const b = (bookings || [])[0] as any
  const c = (customers || [])[0] as any
  if (!b && !c) return {}
  return {
    razonSocial: c?.company_name || b?.company_name || null,
    email: c?.email || b?.client_email || null,
    source: b ? `reserva ${b.code || ''}`.trim() : `cliente ${c.code}`,
  }
}

export async function lookupCompany(rawRut: unknown): Promise<CompanyLookup | null> {
  if (!isValidRut(rawRut)) return null
  const rut = String(rawRut)
  const [sii, panel] = await Promise.all([fromSii(rut).catch(() => ({})), fromPanel(rut).catch(() => ({}))])
  const s = sii as Partial<CompanyLookup> & { source?: string }
  const p = panel as Partial<CompanyLookup> & { source?: string }
  return {
    // La razón social facturada manda sobre la que se escribió al reservar.
    razonSocial: s.razonSocial || p.razonSocial || null,
    giro: s.giro || null,
    direccion: s.direccion || null,
    comuna: s.comuna || null,
    email: p.email || null,
    sources: [s.source, p.source].filter((x): x is string => Boolean(x)),
  }
}
