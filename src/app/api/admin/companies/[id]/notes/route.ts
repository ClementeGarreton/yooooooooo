import { NextRequest, NextResponse } from 'next/server'
import { getActorFromRequest, logAdminAction } from '@/lib/activityLog'
import { CompanyPanelError, addCompanyNote } from '@/lib/companyPanel'

export const dynamic = 'force-dynamic'

/** Agrega una nota al historial de la empresa. Body: `{ body }`. */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const actor = getActorFromRequest(request)
  try {
    const payload = await request.json().catch(() => ({}))
    const { companyName, note } = await addCompanyNote(params.id, payload?.body, actor?.username || null)
    await logAdminAction({
      actor,
      action: 'company.note_added',
      entityType: 'company',
      entityId: params.id,
      entityLabel: companyName,
      summary: `Agregó una nota a ${companyName}: ${note.body.length > 120 ? `${note.body.slice(0, 117)}…` : note.body}`,
      request,
    })
    return NextResponse.json({ note })
  } catch (error) {
    if (error instanceof CompanyPanelError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('[admin/companies/notes] Error:', error)
    return NextResponse.json({ error: 'No se pudo guardar la nota' }, { status: 500 })
  }
}
