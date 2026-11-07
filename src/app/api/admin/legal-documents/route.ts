import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { getActorFromRequest, logAdminAction } from '@/lib/activityLog'
import { LegalDocumentError, listLegalDocuments, resetLegalDocument, saveLegalDocument } from '@/lib/legalDocuments'
import { LEGAL_DOCUMENTS } from '@/lib/legalDocumentTypes'

export const dynamic = 'force-dynamic'

const labelOf = (slug: string) => LEGAL_DOCUMENTS.find((d) => d.slug === slug)?.label || slug

/** Los dos textos legales con lo que tengan editado. */
export async function GET() {
  try {
    return NextResponse.json(await listLegalDocuments())
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Error' }, { status: 500 })
  }
}

/** Publica un texto. Body: `{ slug, content }`. La página del sitio se actualiza al guardar. */
export async function PUT(request: NextRequest) {
  const actor = getActorFromRequest(request)
  try {
    const body = await request.json().catch(() => ({}))
    const document = await saveLegalDocument(body?.slug, body?.content, actor?.username || 'administrador')
    revalidatePath(`/${document.slug}`)
    await logAdminAction({
      actor,
      action: 'legal_document.updated',
      entityType: 'settings',
      entityLabel: labelOf(document.slug),
      summary: `Publicó un texto nuevo de ${labelOf(document.slug)}`,
      request,
    })
    return NextResponse.json({ ok: true, document })
  } catch (error) {
    if (error instanceof LegalDocumentError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('[admin/legal-documents] Error:', error)
    return NextResponse.json({ error: 'No se pudo guardar el texto' }, { status: 500 })
  }
}

/** Vuelve al texto original del sitio. `?slug=`. */
export async function DELETE(request: NextRequest) {
  const actor = getActorFromRequest(request)
  try {
    const slug = await resetLegalDocument(request.nextUrl.searchParams.get('slug'))
    revalidatePath(`/${slug}`)
    await logAdminAction({
      actor,
      action: 'legal_document.reset',
      entityType: 'settings',
      entityLabel: labelOf(slug),
      summary: `Restauró el texto original de ${labelOf(slug)}`,
      request,
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof LegalDocumentError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('[admin/legal-documents] Error:', error)
    return NextResponse.json({ error: 'No se pudo restaurar el texto' }, { status: 500 })
  }
}
