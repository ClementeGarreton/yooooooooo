// Lado servidor de «Ver como» (ver adminPreview.ts): lee la cookie de vista previa de la
// petición y la da por buena solo si TAMBIÉN hay una sesión de admin viva.

import { cookies } from 'next/headers'
import { verifySessionToken } from '@/lib/adminSession'
import { ADMIN_PREVIEW_COOKIE, verifyPreviewToken, type AdminPreview, type PreviewKind } from '@/lib/adminPreview'

/** La vista previa activa de este navegador, o null. */
export async function getActivePreview(kind: PreviewKind): Promise<(AdminPreview & { admin: string }) | null> {
  const store = cookies()
  const preview = await verifyPreviewToken(store.get(ADMIN_PREVIEW_COOKIE)?.value)
  if (!preview || preview.kind !== kind) return null
  const actor = await verifySessionToken(store.get('admin_authenticated')?.value)
  if (!actor) return null
  return { ...preview, admin: actor.username }
}
