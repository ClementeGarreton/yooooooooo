import { NextRequest, NextResponse } from 'next/server'
import { FleetConfigError, getSlotAvailability } from '@/lib/slotAvailability'

// Marcar esta ruta como dinámica porque usa searchParams
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const date = request.nextUrl.searchParams.get('date')

    if (!date) {
      return NextResponse.json(
        { error: 'Fecha requerida' },
        { status: 400 }
      )
    }

    // La cuenta de cupos vive en slotAvailability.ts: la comparte la reprogramación
    // del Panel del Cliente.
    const availability = await getSlotAvailability(date)

    // Filtrar solo los disponibles (no mostrar llenos)
    const availableOnly = availability.filter(slot => slot.isAvailable)

    return NextResponse.json(availableOnly)
  } catch (error) {
    if (error instanceof FleetConfigError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.kind === 'missing' ? 404 : 500 }
      )
    }
    console.error('Error in /api/bookings/available:', error)
    return NextResponse.json(
      { error: 'Error obteniendo disponibilidad' },
      { status: 500 }
    )
  }
}
