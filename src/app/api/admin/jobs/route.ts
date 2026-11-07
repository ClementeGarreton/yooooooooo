import { NextRequest, NextResponse } from 'next/server'
import { JobError, getAdminJobs } from '@/lib/adminJobs'

export const dynamic = 'force-dynamic'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
/** Tope del rango: esto es para asignar lo que viene, no un reporte. */
const MAX_DAYS = 62

function chileDate(offsetDays = 0): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date(Date.now() + offsetDays * 86_400_000))
}

/** Trabajos entre `?desde=` y `?hasta=` (por defecto, hoy y los 13 días siguientes), con camión y cuadrilla. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  let from = params.get('desde') || ''
  let to = params.get('hasta') || ''
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000
  if (!DATE_RE.test(from) || !DATE_RE.test(to) || Number.isNaN(days) || days < 0 || days > MAX_DAYS) {
    from = chileDate(0)
    to = chileDate(13)
  }
  try {
    return NextResponse.json(await getAdminJobs(from, to))
  } catch (error) {
    const status = error instanceof JobError ? error.status : 500
    if (!(error instanceof JobError)) console.error('[admin/jobs] Error:', error)
    return NextResponse.json({ error: error instanceof JobError ? error.message : 'No se pudieron cargar los trabajos' }, { status })
  }
}
