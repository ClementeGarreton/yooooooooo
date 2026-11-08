import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

/** Lectura/gestión de solicitudes humanas en Prospectos, incluso sin cotización completa. */
export async function GET() {
  const { data, error } = await supabaseAdmin.from('handoff_requests')
    .select('id,phone,channel,quote_session_id,quote_id,customer_name,customer_email,reason,details,quote_snapshot,status,created_at')
    .in('status', ['pending', 'ready']).order('created_at', { ascending: false }).limit(200)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data || [])
}

export async function PATCH(request: NextRequest) {
  const { id } = await request.json()
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'Solicitud inválida' }, { status: 400 })
  }
  const { error } = await supabaseAdmin.from('handoff_requests')
    .update({ status: 'attended', updated_at: new Date().toISOString() })
    .eq('id', id).in('status', ['pending', 'ready'])
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
