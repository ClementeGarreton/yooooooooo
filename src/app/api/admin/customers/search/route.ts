import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

/**
 * Busca personas en `customers` por nombre, correo o código (CL-000123), para asociarlas
 * a una empresa. Devuelve también a qué empresa pertenecen hoy, si a alguna.
 */
export async function GET(request: NextRequest) {
  // Fuera lo que tiene significado en el filtro `or` de PostgREST o en un ILIKE.
  const q = (request.nextUrl.searchParams.get('q') || '').replace(/[,()%*\\"]/g, ' ').trim().slice(0, 80)
  if (q.length < 2) return NextResponse.json({ customers: [] })

  const { data, error } = await supabaseAdmin
    .from('customers')
    .select('id, code, name, email, phone, company_id, company_role')
    .or(`name.ilike.%${q}%,email.ilike.%${q}%,code.ilike.%${q}%`)
    .order('name')
    .limit(12)
  if (error) {
    console.error('[admin/customers/search] Error:', error)
    return NextResponse.json({ error: 'No se pudo buscar' }, { status: 500 })
  }
  return NextResponse.json({ customers: data || [] })
}
