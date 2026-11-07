import { NextRequest, NextResponse } from 'next/server'
import { segmentDistanceServer } from '@/lib/server/geoapifyServer'

/**
 * API Route para calcular distancia entre dos puntos usando Geoapify Routing.
 * Esta ruta actúa como proxy para evitar problemas de CORS desde el navegador.
 *
 * La llamada a Geoapify vive en `src/lib/server/geoapifyServer.ts` porque
 * `/api/quote/calculate` la necesita sin dar el salto por HTTP. Acá solo se traduce el
 * resultado a una respuesta, con los mismos códigos y cuerpos de antes.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { originLat, originLng, destLat, destLng } = body

    const result = await segmentDistanceServer(originLat, originLng, destLat, destLng)

    if (result.ok) {
      return NextResponse.json({
        kilometers: result.kilometers,
        duration: result.duration,
      })
    }

    if (result.status === 'NO_API_KEY' || result.status === 'MISSING_PARAMS' || result.status === 'INVALID_COORDS') {
      return NextResponse.json({ error: result.error }, { status: result.httpStatus })
    }

    return NextResponse.json(
      {
        error: result.error,
        status: result.upstreamStatus ?? result.status,
        details: result.details,
      },
      { status: result.httpStatus }
    )
  } catch (error) {
    console.error('Error in distance API:', error)
    return NextResponse.json(
      { error: 'Internal server error', details: String(error) },
      { status: 500 }
    )
  }
}
