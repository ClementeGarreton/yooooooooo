/**
 * DISTANCIA DE LA RUTA CON PARADAS — una sola orquestación para los dos lados.
 *
 * Los kilómetros se cobran, así que medirlos distinto en la web y en el chat sería
 * cotizar distinto. La lógica de "sumá los tramos, y si alguno no se puede medir caete
 * al viaje directo" vive acá una sola vez; lo único que cambia entre un lado y el otro
 * es CÓMO se geocodifica y cómo se mide un tramo, que entra por `deps`:
 *
 *  - en el navegador, pegándole a `/api/maps/*` (con caché y deduplicación),
 *  - en el servidor, llamando a Geoapify directo (ver `server/geoapifyServer.ts`).
 */

/** Un punto de la ruta. Misma forma que las direcciones del cotizador. */
export interface RoutePoint {
  street: string
  number: string
  commune: string
  region: string
}

export interface RouteDistanceDeps {
  /** Coordenadas del punto, o null si no se pudo resolver (incluye las guardas). */
  geocode: (point: RoutePoint) => Promise<{ lat: number; lng: number } | null>
  /** Kilómetros de manejo entre dos coordenadas, o null si no se pudo medir. */
  segmentKm: (
    a: { lat: number; lng: number },
    b: { lat: number; lng: number }
  ) => Promise<number | null>
  /** Lo que se devuelve cuando no se pudo medir nada. */
  defaultDistance: number
}

/**
 * Distancia total de una ruta con paradas: origen → parada 1 → … → destino.
 *
 * Suma los tramos en vez de medir origen→destino en línea. Con paradas eso subestimaba
 * el viaje real, y como los km se cobran, subestimaba el precio.
 *
 * SI ALGÚN TRAMO NO SE PUEDE MEDIR se cae al viaje directo origen→destino (el
 * comportamiento anterior) y, si eso tampoco se puede, a la distancia por defecto. Se
 * prefiere quedarse corto antes que inflar: un fallo de geocodificación no puede
 * terminar en un cobro de más al cliente.
 */
export async function routeDistanceWith(
  points: RoutePoint[],
  deps: RouteDistanceDeps
): Promise<number> {
  const validos = (points || []).filter((p) => p && p.street && p.commune)
  if (validos.length < 2) return deps.defaultDistance

  const directo = async (): Promise<number> => {
    try {
      const a = await deps.geocode(validos[0])
      const b = await deps.geocode(validos[validos.length - 1])
      if (a && b) {
        const km = await deps.segmentKm(a, b)
        if (km !== null && km !== undefined) return km
      }
      console.warn('[maps] Using default distance')
      return deps.defaultDistance
    } catch (error) {
      console.error('[maps] Error midiendo el viaje directo:', error)
      return deps.defaultDistance
    }
  }

  // Sin paradas es exactamente el cálculo de siempre.
  if (validos.length === 2) return directo()

  try {
    const coords = await Promise.all(validos.map((p) => deps.geocode(p)))
    if (coords.some((c) => !c)) {
      console.warn('[maps] Alguna parada no se pudo geocodificar; se usa el viaje directo')
      return directo()
    }

    let total = 0
    for (let i = 0; i < coords.length - 1; i++) {
      const tramo = await deps.segmentKm(coords[i]!, coords[i + 1]!)
      if (tramo === null || tramo === undefined) {
        console.warn(`[maps] No se pudo medir el tramo ${i + 1}; se usa el viaje directo`)
        return directo()
      }
      total += tramo
    }
    return total
  } catch (error) {
    console.error('[maps] Error calculando la ruta con paradas:', error)
    return directo()
  }
}
