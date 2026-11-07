/** @type {import('next').NextConfig} */
// CSP en modo Report-Only: registra violaciones en la consola del navegador
// pero NO bloquea nada. Es el paso previo a moverla a `Content-Security-Policy`
// (enforcement) una vez verificada en producción. La política refleja lo que
// realmente usa el navegador hoy: Meta Pixel (connect.facebook.net /
// facebook.com), imágenes de Unsplash/placeholder, y todo lo demás same-origin.
// Supabase, Geoapify y Flow se consumen desde el servidor, no desde el cliente.
const CSP_REPORT_ONLY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://connect.facebook.net",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://images.unsplash.com https://via.placeholder.com https://www.facebook.com https://graph.facebook.com",
  "font-src 'self' data:",
  "connect-src 'self' https://graph.facebook.com https://www.facebook.com https://connect.facebook.net",
  "frame-ancestors 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ')

const nextConfig = {
  reactStrictMode: true,
  images: {
    domains: ['images.unsplash.com', 'via.placeholder.com'],
    formats: ['image/avif', 'image/webp'],
  },
  env: {
    NEXT_PUBLIC_GEOAPIFY_API_KEY: process.env.NEXT_PUBLIC_GEOAPIFY_API_KEY,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  },
  // Headers para mejorar SEO y seguridad
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-DNS-Prefetch-Control',
            value: 'on'
          },
          {
            key: 'X-Frame-Options',
            value: 'SAMEORIGIN'
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff'
          },
          {
            key: 'Referrer-Policy',
            value: 'origin-when-cross-origin'
          },
          {
            // Solo reporta (no bloquea): verificar en producción antes de pasarla
            // a `Content-Security-Policy`. Ver comentario de CSP_REPORT_ONLY arriba.
            key: 'Content-Security-Policy-Report-Only',
            value: CSP_REPORT_ONLY
          },
          {
            // Sensores y APIs que la app no usa: denegados en serio.
            // clipboard-write en (*) porque CopyCode y paneles lo necesitan y
            // no hay iframes de terceros; clipboard-read queda restringido a self.
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), clipboard-write=(*), clipboard-read=(self)'
          },
        ],
      },
    ]
  },
}

module.exports = nextConfig

