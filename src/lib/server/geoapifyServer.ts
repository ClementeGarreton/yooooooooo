/**
 * LLAMADAS A GEOAPIFY DESDE EL SERVIDOR — sin pasar por HTTP.
 *
 * La lógica vivía dentro de `/api/maps/geocode` y `/api/maps/distance`, que son proxies
 * para el navegador. El endpoint de cotización (`/api/quote/calculate`) corre en el
 * mismo servidor y necesita lo mismo, pero llamarse a sí mismo por HTTP sería un salto
 * de red al pedo y, peor, pasaría por el rate limit: todas las cotizaciones del chatbot
 * saldrían de la IP del servidor y se cortarían entre ellas.
 *
 * Así que la lógica vive acá y las rutas de `/api/maps/*` quedaron como envoltorios.
 * Es la MISMA función en los dos caminos: las guardas de geocodificación —incluida la
 * de región, que es la que evita cobrar 400 km de más— valen igual para la web y para
 * el chat, que era justamente el punto.
 */

import { MAPS_CONFIG, regionName, sameRegion } from '@/config/maps'

export interface GeocodeQuery {
  street: string
  number?: string
  commune: string
  region: string
}

export interface GeocodeOk {
  ok: true
  lat: number
  lng: number
  resultType: string | null
  matchType: string
  formatted: string | null
}

export interface GeocodeFail {
  ok: false
  /** Código estable para el que llama: TOO_COARSE, WRONG_REGION, ERROR, NO_API_KEY… */
  status: string
  /** Código HTTP que devolvió Geoapify, cuando el fallo vino de ahí. */
  upstreamStatus?: number
  error: string
  details?: unknown
  requestedRegion?: string | null
  returnedRegion?: string | null
  formatted?: string | null
  resultType?: string | null
  httpStatus: number
}

export type GeocodeOutcome = GeocodeOk | GeocodeFail

/**
 * Geocodifica en modo ESTRUCTURADO (street/housenumber/city/state/country por separado)
 * en vez de mandar una sola cadena de texto libre. Con texto libre, si Geoapify no
 * entendía alguna parte la descartaba en silencio y hacía match por lo que sí reconocía
 * —el nombre de la comuna— devolviendo una comuna homónima de otra región con toda
 * confianza. En estructurado, `state` acota la búsqueda de verdad. Ver el comentario de
 * REGION_NAMES en src/config/maps.ts para el caso que lo destapó.
 */
export async function geocodeAddressServer(query: GeocodeQuery): Promise<GeocodeOutcome> {
  const { street, number, commune, region } = query

  if (!MAPS_CONFIG.apiKey) {
    return {
      ok: false,
      status: 'NO_API_KEY',
      error: 'Geoapify API key not configured',
      httpStatus: 500,
    }
  }

  if (!street || !commune || !region) {
    return {
      ok: false,
      status: 'MISSING_PARAMS',
      error: 'Missing required parameters',
      httpStatus: 400,
    }
  }

  // El slug del <select> ("metropolitana") no es un topónimo; hay que traducirlo.
  const estado = regionName(region)
  const etiqueta = `${street} ${number || ''}, ${commune}, ${estado}`

  const url = new URL(MAPS_CONFIG.geocodingUrl)
  url.searchParams.append('street', String(street))
  if (number) url.searchParams.append('housenumber', String(number))
  url.searchParams.append('city', String(commune))
  if (estado) url.searchParams.append('state', estado)
  url.searchParams.append('country', 'Chile')
  url.searchParams.append('apiKey', MAPS_CONFIG.apiKey)
  url.searchParams.append('lang', MAPS_CONFIG.language)
  url.searchParams.append('limit', '1')

  const response = await fetch(url.toString())

  if (!response.ok) {
    const errorText = await response.text()
    console.error(
      'Geoapify Geocoding API error:',
      response.status,
      response.statusText,
      errorText
    )
    return {
      ok: false,
      status: 'UPSTREAM_ERROR',
      upstreamStatus: response.status,
      error: 'Geoapify Geocoding API error',
      details: errorText,
      httpStatus: 400,
    }
  }

  const data = await response.json()

  if (!data.features || data.features.length === 0) {
    return {
      ok: false,
      status: 'ERROR',
      error: 'Geocoding failed',
      details: data,
      httpStatus: 400,
    }
  }

  const feature = data.features[0]
  const coordinates = feature.geometry.coordinates
  const props = feature.properties || {}
  const matchType = props.rank?.match_type || 'desconocido'

  // Se deja constancia de CUÁNTO se resolvió. Un `match_by_city_or_disrict` es el
  // centroide de la comuna (aproximación aceptable de unos pocos km), no la dirección
  // exacta: si un día una distancia vuelve a verse rara, el log dice si fue por esto. Un
  // match a nivel país/región sí sería basura y se rechaza abajo.
  console.info(
    `[geocode] ${etiqueta} -> ${props.formatted || 's/d'} (${props.result_type || 's/d'} / ${matchType})`
  )

  // Guarda contra el fallo que originó todo esto: si Geoapify no logró ubicar ni la
  // comuna, devuelve el centroide del país o de la región y eso, convertido en kilómetros
  // cobrables, es un sobreprecio de cientos de miles de pesos. Vale mucho más quedarse
  // sin distancia (el cotizador cae a su valor por defecto y alguien la revisa) que
  // cobrar una inventada.
  if (props.result_type === 'country' || props.result_type === 'state') {
    console.warn(`[geocode] RECHAZADO: ${etiqueta} solo resolvió a nivel ${props.result_type}`)
    return {
      ok: false,
      status: 'TOO_COARSE',
      error: 'Geocoding too coarse',
      resultType: props.result_type,
      httpStatus: 400,
    }
  }

  // LA GUARDA QUE FALTABA: que el resultado esté en la región que se pidió.
  //
  // Cuando la calle no matchea exacto, Geoapify degrada a `match_by_city_or_disrict` y
  // AHÍ IGNORA el `state`: busca la comuna por nombre en todo el país y devuelve la
  // primera homónima. Verificado contra la API el 12-sep-2026: «Americo vespucio 1835,
  // Las Condes, Región Metropolitana» devuelve *Las Condes, Monte Patria, Región de
  // Coquimbo* — 400 km de más, con `result_type: 'city'`, que la guarda anterior
  // aceptaba.
  //
  // Medido antes de esto: 37 cotizaciones con origen y destino en la misma región y más
  // de 100 km, ~$14,4M de sobreprecio. Se prefiere quedarse sin distancia (el cotizador
  // cae a su valor por defecto y alguien revisa) antes que cobrar una inventada.
  if (!sameRegion(estado, props.state)) {
    console.warn(
      `[geocode] RECHAZADO: ${etiqueta} cayó en ${props.state || 's/d'} (${props.formatted || 's/d'})`
    )
    return {
      ok: false,
      status: 'WRONG_REGION',
      error: 'Geocoding fell in another region',
      requestedRegion: estado,
      returnedRegion: props.state || null,
      formatted: props.formatted || null,
      httpStatus: 400,
    }
  }

  return {
    ok: true,
    lat: coordinates[1],
    lng: coordinates[0],
    resultType: props.result_type || null,
    matchType,
    formatted: props.formatted || null,
  }
}

export interface SegmentDistance {
  kilometers: number
  /** Minutos. */
  duration: number
}

export interface SegmentFail {
  ok: false
  status: string
  upstreamStatus?: number
  error: string
  details?: unknown
  httpStatus: number
}

export type SegmentOutcome = ({ ok: true } & SegmentDistance) | SegmentFail

/** Kilómetros de manejo entre dos coordenadas, según el ruteo de Geoapify. */
export async function segmentDistanceServer(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number
): Promise<SegmentOutcome> {
  if (!MAPS_CONFIG.apiKey) {
    return {
      ok: false,
      status: 'NO_API_KEY',
      error: 'Geoapify API key not configured',
      httpStatus: 500,
    }
  }

  if (
    originLat === undefined ||
    originLng === undefined ||
    destLat === undefined ||
    destLng === undefined
  ) {
    return {
      ok: false,
      status: 'MISSING_PARAMS',
      error: 'Missing required parameters: originLat, originLng, destLat, destLng',
      httpStatus: 400,
    }
  }

  if (isNaN(originLat) || isNaN(originLng) || isNaN(destLat) || isNaN(destLng)) {
    return {
      ok: false,
      status: 'INVALID_COORDS',
      error: 'Coordinates must be valid numbers',
      httpStatus: 400,
    }
  }

  const url = new URL(MAPS_CONFIG.distanceMatrixUrl)
  // Geoapify Routing requiere formato lat,lon (no lon,lat como en GeoJSON)
  url.searchParams.append('waypoints', `${originLat},${originLng}|${destLat},${destLng}`)
  url.searchParams.append('mode', 'drive') // Requerido: modo de conducción
  url.searchParams.append('apiKey', MAPS_CONFIG.apiKey)

  const response = await fetch(url.toString())

  if (!response.ok) {
    const errorText = await response.text()
    console.error(
      'Geoapify Distance API error:',
      response.status,
      response.statusText,
      errorText
    )
    return {
      ok: false,
      status: 'UPSTREAM_ERROR',
      upstreamStatus: response.status,
      error: 'Geoapify Distance API error',
      details: errorText,
      httpStatus: 400,
    }
  }

  const data = await response.json()

  if (!data.features || data.features.length === 0) {
    return {
      ok: false,
      status: 'ERROR',
      error: 'Distance calculation failed',
      details: data,
      httpStatus: 400,
    }
  }

  const properties = data.features[0].properties
  const distance = properties.distance // metros
  const duration = properties.time // segundos

  return {
    ok: true,
    // Se conservan 2 decimales (no se redondea a km entero): un traslado dentro de un
    // mismo edificio/condominio puede ser de pocos metros y antes se perdía esa precisión.
    kilometers: Math.round((distance / 1000) * 100) / 100,
    duration: Math.round(duration / 60),
  }
}
