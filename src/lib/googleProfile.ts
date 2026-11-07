/**
 * Los dos enlaces de Google de Yo Me Encargo (entregados por Tomás el 13-10-2026), en un
 * solo lugar: los usan la landing y el correo de reseña del día después de la mudanza.
 */

/** Abre directo el formulario para escribir una reseña. */
export const GOOGLE_REVIEW_URL = 'https://g.page/r/CedSh402D-Z9EBM/review'

/** La ficha del negocio en Google, con las reseñas publicadas. */
export const GOOGLE_PROFILE_URL = 'https://share.google/s7w5NqZAzaThCQEbW'

/**
 * CID de la ficha (el número de `0x7de60f368d8752e7`, que trae el link de reseñas al abrirlo
 * en Maps). Con él `googleReviews.ts` confirma que el Place ID encontrado es el nuestro.
 */
export const GOOGLE_PLACE_CID = '9071955226361549543'
