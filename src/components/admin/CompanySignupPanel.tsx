'use client'

import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import Button from '@/components/ui/Button'
import Card from '@/components/ui/Card'
import type { CompanySignupAction, CompanySignupLink } from '@/lib/companySignup'
import { siteUrl } from '@/lib/siteUrl'

/**
 * Link de registro de empresas (Empresas): un link único, con o sin clave, para mandar por
 * WhatsApp o correo. La empresa se registra sola, queda con su persona como encargada y le
 * llega el correo de acceso.
 */
export default function CompanySignupPanel({ onRegistered }: { onRegistered?: () => void }) {
  const [data, setData] = useState<CompanySignupLink | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/company-signup')
    const body = await res.json().catch(() => null)
    if (res.ok && body) setData(body)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const act = async (action: CompanySignupAction, ok: string) => {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch('/api/admin/company-signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error || 'No se pudo guardar')
      setData(json)
      toast.success(ok)
      onRegistered?.()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo guardar')
    } finally {
      setBusy(false)
    }
  }

  if (!data) return null
  if (!data.available) {
    return (
      <Card className="p-4 text-sm text-amber-800">
        Para que las empresas se registren solas con un link falta correr la migración <code>database/migrations/add_pendientes_oct.sql</code>.
      </Card>
    )
  }

  const url = data.token ? `${siteUrl()}/mi-cuenta/registro-empresa/${data.token}` : null
  const message = url ? `Registra tu empresa en Yo Me Encargo: ${url}${data.requirePin ? `\nClave: ${data.pin}` : ''}` : ''

  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900">Link de registro para empresas</p>
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
            <p className="text-xs text-gray-600">Cerrado. Ábrelo para que una empresa se registre sola y entre a su cuenta.</p>
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
        <input
          type="checkbox"
          checked={data.requirePin}
          disabled={busy}
          onChange={(e) => act(e.target.checked ? 'require-pin' : 'no-pin', e.target.checked ? 'El link pide clave' : 'El link ya no pide clave')}
        />
        Pedir clave al registrarse (el link no cambia)
      </label>
      <p className="text-xs text-gray-500">
        Quien se registra queda como encargado de su empresa y le llega el correo con el acceso. Una empresa con un RUT que ya existe no se
        puede registrar de nuevo: a esas personas se las agrega desde la ficha de la empresa.
      </p>
    </Card>
  )
}
