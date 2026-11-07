import { NextResponse } from 'next/server'
import { listAdminModifications } from '@/lib/bookingModifications'

export const dynamic = 'force-dynamic'

/** Modificaciones en terreno para la bandeja «Por aprobar» (sesión: middleware). */
export async function GET() {
  return NextResponse.json(await listAdminModifications())
}
