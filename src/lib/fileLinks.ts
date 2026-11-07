// Links a archivos (fotos del cliente, PDF de cotizaciones y reservas) SIN mostrar la
// dirección del proyecto de base de datos. Los archivos siguen guardados en el mismo lugar;
// lo que cambia es por dónde se piden: `/archivos/...` en el dominio del sitio, que los
// entrega desde el servidor (ver src/app/archivos/[...path]/route.ts).
//
// Sin dependencias de servidor: lo usan componentes, rutas y plantillas de correo.

import { siteUrl } from '@/lib/siteUrl'

/** Bucket y carpetas que se entregan por `/archivos`. Nada más sale por ahí. */
export const PUBLIC_FILE_BUCKET = 'bookings'
export const PUBLIC_FILE_FOLDERS = ['photos', 'booking-pdfs', 'prospect-pdfs'] as const

const STORAGE_PUBLIC_RE = /^https?:\/\/[^/]+\/storage\/v1\/object\/public\/bookings\/(.+)$/i

/** Link del sitio para una ruta dentro del bucket (p. ej. `photos/123_1.jpg`). */
export function hiddenFileUrl(path: string, base = ''): string {
  return `${base.replace(/\/$/, '')}/archivos/${PUBLIC_FILE_BUCKET}/${path.replace(/^\/+/, '')}`
}

/**
 * Convierte un link guardado en la base (el público del almacenamiento) en el link del sitio.
 * Lo que no calza con ese formato —otro dominio, un link ya convertido, vacío— vuelve igual.
 * `base` = dominio para links que salen del sitio (correos); vacío = link relativo.
 */
export function toHiddenFileUrl<T extends string | null | undefined>(url: T, base = ''): T {
  if (!url || typeof url !== 'string') return url
  const match = STORAGE_PUBLIC_RE.exec(url.trim())
  return (match ? hiddenFileUrl(match[1], base) : url) as T
}

/** Dominio del sitio para links absolutos (correos, links que se copian). */
export function siteBaseUrl(): string {
  return siteUrl()
}
