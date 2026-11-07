import { NextResponse } from 'next/server'
import { getFleetKm } from '@/lib/fleetKm'

export const dynamic = 'force-dynamic'

/** Patente, marca y kilometraje (leído y estimado) de cada camión. Solo lectura. */
export async function GET() {
  try {
    return NextResponse.json(await getFleetKm())
  } catch (error) {
    console.error('[admin/fleet-km] Error:', error)
    return NextResponse.json({ error: 'No se pudo cargar el kilometraje' }, { status: 500 })
  }
}
