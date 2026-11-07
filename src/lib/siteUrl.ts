/**
 * Dominio público con el que se arman TODOS los links que salen del sistema: los que se
 * copian o se mandan por WhatsApp desde el panel, los de los correos, los de pago de Flow
 * y sus vueltas. Francisco, 16-10-2026: nunca el dominio de Vercel, siempre yomeencargo.cl.
 *
 * En producción manda `NEXT_PUBLIC_APP_URL` solo si es un dominio propio: si apunta a
 * *.vercel.app o a localhost (variable mal cargada), se usa yomeencargo.cl igual. Fuera de
 * producción (desarrollo local) se respeta la variable, para poder probar en localhost.
 * Sirve en el servidor y en el navegador (la variable es NEXT_PUBLIC_).
 */
export const PUBLIC_SITE_URL = 'https://yomeencargo.cl'

export function siteUrl(): string {
  const env = (process.env.NEXT_PUBLIC_APP_URL || '').trim().replace(/\/+$/, '')
  if (process.env.NODE_ENV !== 'production') return env || 'http://localhost:3000'
  return env && !/vercel\.app/i.test(env) && !/localhost|127\.0\.0\.1/i.test(env) ? env : PUBLIC_SITE_URL
}
