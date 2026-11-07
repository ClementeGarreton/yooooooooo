/**
 * CONFIGURACIÓN DE GEOAPIFY API
 * 
 * Para obtener tu API Key:
 * 1. Ve a: https://www.geoapify.com/
 * 2. Crea una cuenta gratuita
 * 3. Crea un nuevo proyecto
 * 4. Copia la API key y pégala en .env.local:
 *    NEXT_PUBLIC_GEOAPIFY_API_KEY=tu_key_aquí
 * 
 * VENTAJAS DE GEOAPIFY:
 * - 90,000 requests/mes GRATIS (vs 10,000 de Google)
 * - Sin restricciones de almacenamiento de datos
 * - Precios más estables y predecibles
 * - APIs no marcadas como "legacy"
 * - Mejor soporte técnico
 * 
 * IMPORTANTE:
 * - En producción, restringe la key a tu dominio
 * - Plan gratuito: 90,000 requests/mes
 * - Plan Starter: $9/mes para 300,000 requests/mes
 */

export const MAPS_CONFIG = {
  apiKey: process.env.NEXT_PUBLIC_GEOAPIFY_API_KEY || '',
  
  // URLs de Geoapify API
  geocodingUrl: 'https://api.geoapify.com/v1/geocode/search',
  autocompleteUrl: 'https://api.geoapify.com/v1/geocode/autocomplete',
  distanceMatrixUrl: 'https://api.geoapify.com/v1/routing',
  
  // Configuración de fallback
  defaultDistance: 10, // km por defecto si falla la API
  
  // Opciones de la API
  language: 'es',
  country: 'cl', // Chile
  format: 'json',
}

/**
 * Verifica si la API Key está configurada
 */
export const isGeoapifyConfigured = (): boolean => {
  return MAPS_CONFIG.apiKey !== '' && MAPS_CONFIG.apiKey !== undefined
}

/**
 * Slug de región (lo que guarda el <select> del cotizador y lo que queda escrito en
 * `origin_address` / `destination_address`) -> nombre real de la región.
 *
 * POR QUÉ EXISTE ESTO: los slugs no son topónimos. Mandarle "metropolitana" a Geoapify
 * como nombre de región no le dice nada, así que la API descartaba la región y hacía
 * match solo por el nombre de la comuna — y varias comunas de Santiago se repiten en
 * otras regiones de Chile. "Huechuraba, metropolitana" caía en Huechuraba de
 * Panguipulli (Los Ríos), a 870 km, y el cotizador devolvía esa distancia como si nada:
 * a $900/km con 45 km libres eso son $743.490 de sobreprecio en una mudanza de 6,5 km.
 * Detectado el 2026-08-25 con la cotización de Nini (871,1 km Huechuraba -> Vitacura).
 */
export const REGION_NAMES: Record<string, string> = {
  arica: 'Región de Arica y Parinacota',
  tarapaca: 'Región de Tarapacá',
  antofagasta: 'Región de Antofagasta',
  atacama: 'Región de Atacama',
  coquimbo: 'Región de Coquimbo',
  valparaiso: 'Región de Valparaíso',
  metropolitana: 'Región Metropolitana',
  ohiggins: "Región del Libertador General Bernardo O'Higgins",
  maule: 'Región del Maule',
  nuble: 'Región de Ñuble',
  biobio: 'Región del Biobío',
  araucania: 'Región de La Araucanía',
  losrios: 'Región de Los Ríos',
  loslagos: 'Región de Los Lagos',
  aysen: 'Región de Aysén',
  magallanes: 'Región de Magallanes y de la Antártica Chilena',
}

/**
 * Nombre de región apto para geocodificar. Si no es un slug conocido se devuelve tal
 * cual: las direcciones cargadas a mano desde el panel ya vienen con el nombre escrito.
 */
export const regionName = (slug: string | null | undefined): string => {
  const raw = (slug || '').trim()
  return REGION_NAMES[raw.toLowerCase()] || raw
}

/**
 * Reduce un nombre de región a su núcleo comparable: sin acentos, sin mayúsculas, sin
 * las palabras de relleno ("región", "de", "del", "la"...) y sin espacios.
 *
 * Hace falta porque Geoapify NO usa los mismos nombres que nosotros. Medido contra la
 * API el 12-sep-2026, 4 de las 16 regiones difieren:
 *
 *   nuestro                              Geoapify
 *   "Región Metropolitana"           ->  "Región Metropolitana de Santiago"
 *   "Región del Biobío"              ->  "Bío Bío"
 *   "Región de La Araucanía"         ->  "Región de la Araucanía"
 *   "Región de Aysén"                ->  "Aysén"
 *
 * Comparar literal rechazaría Metropolitana, que es el 95% de las cotizaciones.
 */
function regionCore(value: string | null | undefined): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(region|regiones|del|de|la|las|los|el|y)\b/g, '')
    .replace(/[^a-z0-9]/g, '')
}

/**
 * ¿La región que devolvió el geocodificador es la que pedimos?
 *
 * Se acepta que una contenga a la otra: Geoapify agrega o quita calificativos
 * ("Metropolitana" vs "Metropolitana de Santiago") sin que sean regiones distintas. Lo
 * que NO se acepta es que los núcleos no tengan nada que ver — "coquimbo" contra
 * "metropolitana" — que es exactamente el caso que venía inflando las distancias.
 */
export function sameRegion(
  pedida: string | null | undefined,
  devuelta: string | null | undefined
): boolean {
  const a = regionCore(pedida)
  const b = regionCore(devuelta)
  if (!a || !b) return true // sin dato de un lado no se puede afirmar que estén mal
  return a === b || a.includes(b) || b.includes(a)
}

