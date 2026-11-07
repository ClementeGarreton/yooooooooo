import { NextResponse } from 'next/server'
import { getPendingWorkers } from '@/lib/workerSignup'

export const dynamic = 'force-dynamic'

/** Quienes se registraron por el link y esperan aprobación (Por aprobar → Trabajadores nuevos). */
export async function GET() {
  return NextResponse.json({ pending: await getPendingWorkers() })
}
