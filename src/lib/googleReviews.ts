/**
 * Reseñas reales de la ficha de Google de Yo Me Encargo, leídas con Places API (New).
 *
 * Reemplaza a las reseñas escritas a mano: la landing muestra lo que dice la ficha, con el
 * nombre de cada autor y el enlace a Google, y el promedio sale de Google, no del código.
 *
 * Necesita `GOOGLE_PLACES_API_KEY` (clave de Google Cloud con «Places API (New)» activa).
 * `GOOGLE_PLACE_ID` es opcional: sin él, el Place ID se busca por nombre y se confirma con el
 * CID de la ficha (el mismo número que trae el link de reseñas de `googleProfile.ts`).
 * Sin clave, o si Google falla, devuelve null y la landing usa su texto sin reseñas.
 *
 * Se cachea un día (`revalidate`): las reseñas no cambian tan seguido y cada lectura cuesta.
 */

import { GOOGLE_PLACE_CID } from '@/lib/googleProfile'

export interface GoogleReview {
  author: string
  authorUrl: string | null
  rating: number
  text: string
  /** «hace 2 semanas», como lo escribe Google. */
  when: string
}

export interface GoogleReviews {
  rating: number | null
  total: number
  reviews: GoogleReview[]
  mapsUrl: string | null
}

const API = 'https://places.googleapis.com/v1'
const DAY = 60 * 60 * 24

async function findPlaceId(key: string): Promise<string | null> {
  const res = await fetch(`${API}/places:searchText`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': 'places.id,places.googleMapsUri',
    },
    body: JSON.stringify({ textQuery: 'Yo me Encargo mudanzas', languageCode: 'es', regionCode: 'CL' }),
    next: { revalidate: DAY },
  })
  if (!res.ok) return null
  const body = (await res.json()) as { places?: { id?: string; googleMapsUri?: string }[] }
  // Solo la ficha con nuestro CID: el nombre solo podría traer otra empresa.
  const match = (body.places || []).find((p) => String(p.googleMapsUri || '').includes(`cid=${GOOGLE_PLACE_CID}`))
  return match?.id || null
}

export async function getGoogleReviews(): Promise<GoogleReviews | null> {
  const key = process.env.GOOGLE_PLACES_API_KEY
  if (!key) return null
  try {
    const placeId = process.env.GOOGLE_PLACE_ID || (await findPlaceId(key))
    if (!placeId) return null
    const res = await fetch(`${API}/places/${encodeURIComponent(placeId)}?languageCode=es&regionCode=CL`, {
      headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'rating,userRatingCount,reviews,googleMapsUri' },
      next: { revalidate: DAY },
    })
    if (!res.ok) return null
    const body = (await res.json()) as any
    const reviews: GoogleReview[] = (Array.isArray(body.reviews) ? body.reviews : [])
      .map((r: any) => ({
        author: String(r?.authorAttribution?.displayName || ''),
        authorUrl: typeof r?.authorAttribution?.uri === 'string' ? r.authorAttribution.uri : null,
        rating: Number(r?.rating) || 0,
        text: String(r?.text?.text || r?.originalText?.text || '').trim(),
        when: String(r?.relativePublishTimeDescription || ''),
      }))
      .filter((r: GoogleReview) => r.author && r.text && r.rating > 0)
    return {
      rating: typeof body.rating === 'number' ? body.rating : null,
      total: Number(body.userRatingCount) || 0,
      reviews,
      mapsUrl: typeof body.googleMapsUri === 'string' ? body.googleMapsUri : null,
    }
  } catch {
    return null
  }
}
