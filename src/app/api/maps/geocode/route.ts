import { NextRequest, NextResponse } from 'next/server'
import { geocodeAddressServer } from '@/lib/server/geoapifyServer'

/**
 * API Route para geocodificar direcciones usando Geoapify Geocoding.
 * Esta ruta actúa como proxy para evitar problemas de CORS desde el navegador.
 *
 * Toda la lógica —incluidas las guardas de resultado grueso y de región equivocada—
 * vive en `src/lib/server/geoapifyServer.ts`, porque `/api/quote/calculate` necesita lo
 * mismo y llamarse por HTTP a sí mismo pasaría por el rate limit. Acá solo se traduce
 * el resultado a una respuesta HTTP, con los mismos códigos y cuerpos de antes.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { street, number, commune, region } = body

    const result = await geocodeAddressServer({ street, number, commune, region })

    if (result.ok) {
      return NextResponse.json({
        lat: result.lat,
        lng: result.lng,
        resultType: result.resultType,
        matchType: result.matchType,
        formatted: result.formatted,
      })
    }

    const payload: Record<string, unknown> = { error: result.error }
    if (result.status === 'MISSING_PARAMS' || result.status === 'NO_API_KEY') {
      return NextResponse.json(payload, { status: result.httpStatus })
    }
    // El cuerpo mantiene la forma de antes: cuando el fallo viene de Geoapify, `status`
    // es su código HTTP numérico; en las guardas propias es el código estable.
    payload.status = result.upstreamStatus ?? result.status
    if (result.details !== undefined) payload.details = result.details
    if (result.resultType !== undefined) payload.resultType = result.resultType
    if (result.requestedRegion !== undefined) payload.requestedRegion = result.requestedRegion
    if (result.returnedRegion !== undefined) payload.returnedRegion = result.returnedRegion
    if (result.formatted !== undefined) payload.formatted = result.formatted

    return NextResponse.json(payload, { status: result.httpStatus })
  } catch (error) {
    console.error('Error in geocoding API:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
