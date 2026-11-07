/**
 * TEXTOS LEGALES EDITABLES: «Políticas de Garantía» y «Términos y Condiciones».
 *
 * Se editan en Configuración → Políticas y términos. Las dos páginas del sitio muestran lo
 * guardado acá; si no hay nada guardado (o falta `add_legal_documents.sql`), muestran el
 * texto original que viene en el código. Los correos enlazan a esas páginas, así que un
 * cambio acá vale también para lo que lee el cliente desde un correo.
 */

import { supabaseAdmin } from '@/lib/supabase'
import { LEGAL_DOCUMENTS, LEGAL_MAX_CHARS, isLegalSlug, type LegalDocument, type LegalSlug } from '@/lib/legalDocumentTypes'

export class LegalDocumentError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message)
    this.name = 'LegalDocumentError'
  }
}

const isMissingTable = (error: { code?: string } | null | undefined) => error?.code === '42P01' || error?.code === 'PGRST205'

/** El texto editado de una página, o null si se muestra el original. Nunca lanza. */
export async function getLegalContent(slug: LegalSlug): Promise<string | null> {
  try {
    const { data, error } = await supabaseAdmin.from('legal_documents').select('content').eq('slug', slug).maybeSingle()
    if (error) return null
    return data?.content?.trim() ? data.content : null
  } catch {
    return null
  }
}

export async function listLegalDocuments(): Promise<{ available: boolean; documents: LegalDocument[] }> {
  const { data, error } = await supabaseAdmin.from('legal_documents').select('slug, content, updated_by, updated_at')
  if (error && !isMissingTable(error)) throw new LegalDocumentError('No se pudieron cargar los textos', 500)
  const bySlug = new Map((data || []).map((r) => [r.slug, r]))
  return {
    available: !error,
    documents: LEGAL_DOCUMENTS.map(({ slug }) => {
      const row = bySlug.get(slug)
      return { slug, content: row?.content ?? null, updatedBy: row?.updated_by ?? null, updatedAt: row?.updated_at ?? null }
    }),
  }
}

export async function saveLegalDocument(rawSlug: unknown, rawContent: unknown, actor: string): Promise<LegalDocument> {
  if (!isLegalSlug(rawSlug)) throw new LegalDocumentError('Documento desconocido')
  const content = typeof rawContent === 'string' ? rawContent.replace(/\r\n?/g, '\n').trim() : ''
  if (content.length < 200) throw new LegalDocumentError('El texto está vacío o es demasiado corto para publicarlo.')
  if (content.length > LEGAL_MAX_CHARS) throw new LegalDocumentError('El texto es demasiado largo.')
  const { data, error } = await supabaseAdmin
    .from('legal_documents')
    .upsert({ slug: rawSlug, content, updated_by: actor, updated_at: new Date().toISOString() }, { onConflict: 'slug' })
    .select('slug, content, updated_by, updated_at')
    .single()
  if (error || !data) {
    if (isMissingTable(error)) throw new LegalDocumentError('Falta correr la migración add_legal_documents.sql.', 409)
    throw new LegalDocumentError('No se pudo guardar el texto', 500)
  }
  return { slug: data.slug, content: data.content, updatedBy: data.updated_by, updatedAt: data.updated_at }
}

/** Vuelve al texto original del sitio. */
export async function resetLegalDocument(rawSlug: unknown): Promise<LegalSlug> {
  if (!isLegalSlug(rawSlug)) throw new LegalDocumentError('Documento desconocido')
  const { error } = await supabaseAdmin.from('legal_documents').delete().eq('slug', rawSlug)
  if (error) throw new LegalDocumentError('No se pudo restaurar el texto', 500)
  return rawSlug
}
