import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { countSentInMonth } from '@/lib/emailLog'

export const dynamic = 'force-dynamic'

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/

/**
 * Correos automáticos de un mes, para el panel de Marketing: el registro (`email_log`) tal
 * cual, del más nuevo al más viejo, y los conteos por estado y por tipo. `?mes=YYYY-MM`
 * (por defecto, el mes en curso en Chile) o un rango `?desde=&hasta=`. Solo lectura.
 */
export async function GET(request: NextRequest) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date())
  const asked = request.nextUrl.searchParams.get('mes') || ''
  const period = PERIOD_RE.test(asked) ? asked : today.slice(0, 7)
  const [y, m] = period.split('-').map(Number)
  // Mismo corte de mes (UTC) que `countSentInMonth`, el contador que define el tramo del fee.
  let from = `${period}-01T00:00:00Z`
  let to = new Date(Date.UTC(y, m, 1)).toISOString()
  // Rango de días del filtro de fecha del panel (`?desde=&hasta=`): si viene, manda él.
  const desde = request.nextUrl.searchParams.get('desde') || ''
  const hasta = request.nextUrl.searchParams.get('hasta') || ''
  const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
  const ranged = DAY_RE.test(desde) && DAY_RE.test(hasta) && desde <= hasta
  if (ranged) {
    from = `${desde}T00:00:00Z`
    to = new Date(Date.parse(`${hasta}T00:00:00Z`) + 86_400_000).toISOString()
  }

  const { data, error } = await supabaseAdmin
    .from('email_log')
    .select('id, email_type, recipient, status, skip_reason, error, scheduled_for, sent_at, booking_id, created_at')
    .gte('created_at', from)
    .lt('created_at', to)
    .order('created_at', { ascending: false })
    .limit(2000)
  if (error) {
    console.error('[admin/emails] Error:', error)
    return NextResponse.json({ error: 'No se pudieron cargar los correos' }, { status: 500 })
  }

  const rows = data || []
  const byStatus: Record<string, number> = {}
  const byType: Record<string, { sent: number; total: number }> = {}
  for (const r of rows) {
    byStatus[r.status] = (byStatus[r.status] || 0) + 1
    const t = (byType[r.email_type] = byType[r.email_type] || { sent: 0, total: 0 })
    t.total++
    if (r.status === 'sent') t.sent++
  }

  return NextResponse.json({
    period,
    total: rows.length,
    // Enviados en el mes según el contador del fee (por fecha de envío, no de creación).
    sentInMonth: ranged ? rows.filter((r) => r.status === 'sent').length : await countSentInMonth(period),
    // Si el mes tiene más filas que el tope, los conteos son de las más recientes.
    truncated: rows.length === 2000,
    byStatus,
    byType,
    emails: rows.slice(0, 300),
  })
}
