import { NextResponse } from 'next/server'
import { listAdminRequests } from '@/lib/serviceRequests'

export const dynamic = 'force-dynamic'

/** Bandeja «Por aprobar» del admin (sesión: middleware). */
export async function GET() {
  return NextResponse.json(await listAdminRequests())
}
