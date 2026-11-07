'use client'

import { useEffect, useState } from 'react'

/**
 * Modo sin conexión del panel del equipo: registra el service worker de /trabajos (guarda la
 * última versión de cada pantalla) y avisa cuando se está viendo sin señal. En la vista de
 * administrador («Ver como») no se registra, para no guardar la agenda de otro en el equipo.
 */
/**
 * Borra lo guardado para el modo sin conexión. Se llama al salir, en las pantallas de entrada
 * (sesión vencida o de otra persona) y en «Ver como», para que nadie vea sin señal la agenda o
 * los datos de otro.
 */
export async function clearOfflineCache(unregister = false): Promise<void> {
  try {
    navigator.serviceWorker?.controller?.postMessage('borrar')
    if ('caches' in window) {
      const keys = await caches.keys()
      await Promise.all(keys.filter((k) => k.startsWith('trabajos-')).map((k) => caches.delete(k)))
    }
    if (unregister && 'serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.getRegistration('/trabajos')
      await registration?.unregister()
    }
  } catch {
    // Sin soporte o sin permisos: no hay nada guardado que borrar.
  }
}

export default function OfflineSupport({ enabled = true }: { enabled?: boolean }) {
  const [offline, setOffline] = useState(false)

  useEffect(() => {
    if (enabled && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw-trabajos.js', { scope: '/trabajos' }).catch(() => null)
    } else if (!enabled) {
      // Vista de administrador: no guardar nada y borrar lo que hubiera de antes.
      clearOfflineCache(true)
    }
    const update = () => setOffline(!navigator.onLine)
    update()
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [enabled])

  if (!offline) return null
  return (
    <div className="sticky top-0 z-50 bg-amber-500 px-4 py-2 text-center text-sm font-semibold text-amber-950">
      Sin conexión: estás viendo lo último que se guardó. Para marcar inicio o fin, subir fotos o anotar, necesitas señal.
    </div>
  )
}
