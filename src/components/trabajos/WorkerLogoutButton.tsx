'use client'

import { useRouter } from 'next/navigation'
import { clearOfflineCache } from '@/components/trabajos/OfflineSupport'

export default function WorkerLogoutButton() {
  const router = useRouter()
  return (
    <button
      type="button"
      onClick={async () => {
        await fetch('/api/trabajos/salir', { method: 'POST' }).catch(() => null)
        // Borra la agenda guardada para el modo sin conexión (ver public/sw-trabajos.js).
        await clearOfflineCache()
        router.refresh()
      }}
      className="shrink-0 text-sm font-semibold text-slate-200 hover:text-white"
    >
      Salir
    </button>
  )
}
