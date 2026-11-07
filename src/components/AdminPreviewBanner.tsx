'use client'

import { useState } from 'react'

/**
 * Franja que avisa que se está mirando el panel de otra persona desde el admin. Mientras
 * esté, el servidor rechaza cualquier cambio (ver adminPreview.ts).
 */
export default function AdminPreviewBanner({ who }: { who: string }) {
  const [leaving, setLeaving] = useState(false)

  const leave = async () => {
    setLeaving(true)
    await fetch('/api/admin/preview', { method: 'DELETE' }).catch(() => null)
    // La vista se abre en una pestaña nueva: se intenta cerrarla y, si el navegador no
    // deja, se vuelve al admin.
    window.close()
    window.location.href = '/admin'
  }

  return (
    <div className="sticky top-0 z-50 flex flex-wrap items-center justify-between gap-2 bg-amber-400 px-4 py-2 text-sm font-semibold text-amber-950">
      <span>Vista de administrador · estás viendo el panel de {who} · solo lectura: aquí no se puede cambiar nada</span>
      <button type="button" onClick={leave} disabled={leaving} className="rounded-md bg-amber-950 px-3 py-1 text-xs font-bold text-white">
        {leaving ? 'Saliendo…' : 'Salir de la vista'}
      </button>
    </div>
  )
}
