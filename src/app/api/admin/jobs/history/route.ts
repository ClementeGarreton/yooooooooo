import { NextRequest, NextResponse } from 'next/server'
import { searchJobHistory } from '@/lib/jobHistory'

export const dynamic = 'force-dynamic'

/**
 * Historial de trabajos realizados. `?q=` (ID, cliente, teléfono o dirección), `?camion=`,
 * `?trabajador=`, `?desde=`, `?hasta=`, `?pagina=`. Solo lectura.
 */
export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams
  try {
    return NextResponse.json(
      await searchJobHistory({ q: p.get('q'), vehicleId: p.get('camion'), workerId: p.get('trabajador'), from: p.get('desde'), to: p.get('hasta'), page: p.get('pagina') })
    )
  } catch (error) {
    console.error('[admin/jobs/history] Error:', error)
    return NextResponse.json({ error: 'No se pudo cargar el historial' }, { status: 500 })
  }
}
