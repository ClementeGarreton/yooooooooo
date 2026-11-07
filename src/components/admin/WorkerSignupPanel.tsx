'use client'

import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import Button from '@/components/ui/Button'
import type { SignupLink, SignupLinkAction } from '@/lib/workerSignup'
import { siteUrl } from '@/lib/siteUrl'

/**
 * Registro de trabajadores por link (Flota y equipo): un link único para todos, con o sin
 * clave, para mandar por WhatsApp. Quienes se registran quedan en «Por aprobar → Trabajadores
 * nuevos».
 */
export default function WorkerSignupPanel({ onPending }: { onPending: (ids: string[]) => void }) {
  const [data, setData] = useState<(SignupLink & { pendingIds: string[] }) | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/workers/signup')
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || 'No se pudo cargar el registro')
      setData(body)
      onPending(body.pendingIds || [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo cargar el registro')
    }
  }, [onPending])

  useEffect(() => {
    load()
  }, [load])

  const act = async (action: SignupLinkAction, ok: string) => {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch('/api/admin/workers/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error || 'No se pudo guardar')
      toast.success(ok)
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo guardar')
    } finally {
      setBusy(false)
    }
  }

  if (!data) return null
  if (!data.available) {
    return (
      <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
        Para que los trabajadores se registren solos con un link falta correr la migración <code>database/migrations/add_registro_trabajadores.sql</code>.
      </p>
    )
  }

  // Siempre con yomeencargo.cl, aunque el panel se abra desde el dominio de Vercel.
  const url = data.token ? `${siteUrl()}/trabajos/registro/${data.token}` : null
  const message = url ? `Regístrate como trabajador de Yo Me Encargo: ${url}${data.requirePin ? `\nClave: ${data.pin}` : ''}` : ''

  return (
    <div className="mt-4 space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900">Registro por link</p>
          {url ? (
            <p className="break-all text-xs text-gray-600">
              {url}
              {data.requirePin && (
                <>
                  {' '}
                  · clave <span className="font-mono font-semibold text-gray-900">{data.pin}</span>
                </>
              )}
            </p>
          ) : (
            <p className="text-xs text-gray-600">Cerrado. Abre el registro para que cada trabajador se cree su cuenta y tú la apruebes.</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {url ? (
            <>
              <Button size="sm" variant="outline" onClick={() => navigator.clipboard.writeText(message).then(() => toast.success('Link copiado'))}>
                Copiar {data.requirePin ? 'link y clave' : 'link'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  if (window.confirm('¿Cambiar el link? El actual deja de servir: úsalo solo si el link se filtró.')) act('rotate', 'Link cambiado')
                }}
              >
                Cambiar link
              </Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => act('close', 'Registro cerrado')}>
                Cerrar registro
              </Button>
            </>
          ) : (
            <Button size="sm" disabled={busy} onClick={() => act('open', 'Registro abierto')}>
              Abrir registro
            </Button>
          )}
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input type="checkbox" checked={data.requirePin} disabled={busy} onChange={(e) => act(e.target.checked ? 'require-pin' : 'no-pin', e.target.checked ? 'El link pide clave' : 'El link ya no pide clave')} />
        Pedir clave al registrarse (el link no cambia)
      </label>
      {data.pendingIds.length > 0 && (
        <p className="text-sm font-medium text-amber-800">
          {data.pendingIds.length} {data.pendingIds.length === 1 ? 'persona espera' : 'personas esperan'} aprobación en Por aprobar → Trabajadores nuevos.
        </p>
      )}
    </div>
  )
}
