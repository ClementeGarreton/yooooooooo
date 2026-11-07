/*
 * Modo sin conexión del panel del equipo (/trabajos). Tomás, 23-10-2026: «modo offline».
 *
 * Solo para VER: guarda la última versión de cada pantalla de /trabajos que se abrió con
 * señal (agenda, historial, avisos) y los archivos de la app, y si no hay conexión muestra lo
 * guardado. Lo que escribe (inicio y fin, notas, fotos, gastos) necesita señal: no se encola.
 * Al cerrar sesión se borra todo lo guardado (ver WorkerLogoutButton).
 */

const PAGES = 'trabajos-paginas-v1'
const ASSETS = 'trabajos-archivos-v1'

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('trabajos-') && k !== PAGES && k !== ASSETS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('message', (event) => {
  // El panel lo pide al cerrar sesión: no deja la agenda de nadie guardada en el teléfono.
  if (event.data === 'borrar') event.waitUntil(Promise.all([caches.delete(PAGES), caches.delete(ASSETS)]))
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  // Pantallas de /trabajos: primero la red; sin señal, la última guardada.
  if (request.mode === 'navigate' && url.pathname.startsWith('/trabajos')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone()
            caches.open(PAGES).then((cache) => cache.put(request, copy))
          }
          return response
        })
        .catch(async () => {
          const cache = await caches.open(PAGES)
          return (
            (await cache.match(request)) ||
            (await cache.match('/trabajos')) ||
            new Response(
              '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:sans-serif;padding:24px"><h1>Sin conexión</h1><p>Esta pantalla no se alcanzó a guardar. Ábrela de nuevo cuando tengas señal.</p></body>',
              { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
            )
          )
        })
    )
    return
  }

  // Archivos de la app (código, estilos, letras, logo): primero lo guardado.
  if (url.pathname.startsWith('/_next/static/') || /\.(png|svg|ico|woff2?)$/.test(url.pathname)) {
    event.respondWith(
      caches.open(ASSETS).then(async (cache) => {
        const hit = await cache.match(request)
        if (hit) return hit
        const response = await fetch(request)
        if (response.ok) cache.put(request, response.clone())
        return response
      })
    )
  }
})
