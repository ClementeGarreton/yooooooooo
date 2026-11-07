'use client'

import { useEffect, useState } from 'react'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import { Link2, Copy, RefreshCw, MessageCircle, Check, KeyRound } from 'lucide-react'
import toast from 'react-hot-toast'
import { resolveVehicleColor } from '@/lib/vehicleColors'
import { buildWhatsAppShareLink, driverAccessMessage } from '@/lib/whatsapp'
import { siteUrl } from '@/lib/siteUrl'

interface VehicleLink {
  id: number
  name: string
  driver: string
  status: string
  color?: string
  token: string | null
  pin: string
  usesGeneralPin: boolean
}

export default function DriverAccessCard() {
  const [vehicles, setVehicles] = useState<VehicleLink[]>([])
  const [generalToken, setGeneralToken] = useState<string | null>(null)
  const [generalPin, setGeneralPin] = useState('')
  const [loading, setLoading] = useState(true)
  /** id del camión sobre el que hay una operación en curso ('general' para el link viejo). */
  const [working, setWorking] = useState<string | null>(null)
  const [pinDrafts, setPinDrafts] = useState<Record<number, string>>({})
  const [origin, setOrigin] = useState('')

  useEffect(() => {
    // Los links que se mandan a los choferes van con yomeencargo.cl aunque el panel se
    // abra desde el dominio de Vercel.
    setOrigin(siteUrl())
    load()
  }, [])

  const load = async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/admin/driver-link')
      if (res.ok) {
        const data = await res.json()
        const list: VehicleLink[] = Array.isArray(data.vehicles) ? data.vehicles : []
        setVehicles(list)
        setGeneralToken(data.token || null)
        setGeneralPin(data.pin || '')
        setPinDrafts(
          Object.fromEntries(list.map((v) => [v.id, v.usesGeneralPin ? '' : v.pin]))
        )
      }
    } catch (error) {
      console.error('Error fetching driver links:', error)
    } finally {
      setLoading(false)
    }
  }

  const linkFor = (token: string | null) => (token && origin ? `${origin}/trabajos/${token}` : '')

  const copy = async (texto: string, aviso = 'Link copiado') => {
    if (!texto) return
    try {
      await navigator.clipboard.writeText(texto)
      toast.success(aviso)
    } catch {
      toast.error('No se pudo copiar')
    }
  }

  // Sin destinatario a propósito: abre el selector de contactos de WhatsApp para elegir
  // a quién mandarle el acceso de ese camión.
  const waHref = (link: string, label: string, pin: string) =>
    link ? buildWhatsAppShareLink(driverAccessMessage(label, link, pin)) : ''

  const generate = async (vehicle: VehicleLink) => {
    setWorking(String(vehicle.id))
    try {
      const res = await fetch('/api/admin/driver-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vehicleId: vehicle.id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'error')
      setVehicles((prev) =>
        prev.map((v) => (v.id === vehicle.id ? { ...v, token: data.token } : v))
      )
      toast.success(
        vehicle.token
          ? `Link de ${vehicle.name} regenerado — el anterior dejó de funcionar`
          : `Link de ${vehicle.name} generado`
      )
    } catch (error) {
      console.error('Error generating driver link:', error)
      toast.error(error instanceof Error ? error.message : 'No se pudo generar el link')
    } finally {
      setWorking(null)
    }
  }

  const savePin = async (vehicle: VehicleLink) => {
    const draft = (pinDrafts[vehicle.id] ?? '').trim()
    if (draft && !/^\d{4,8}$/.test(draft)) {
      toast.error('La clave debe tener entre 4 y 8 dígitos')
      return
    }

    setWorking(`pin-${vehicle.id}`)
    try {
      const res = await fetch('/api/admin/driver-link', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vehicleId: vehicle.id, pin: draft }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'error')
      setVehicles((prev) =>
        prev.map((v) =>
          v.id === vehicle.id
            ? { ...v, pin: data.pin, usesGeneralPin: Boolean(data.usesGeneralPin) }
            : v
        )
      )
      toast.success(
        draft ? `Clave de ${vehicle.name} actualizada` : `${vehicle.name} vuelve a la clave general`
      )
    } catch (error) {
      console.error('Error saving driver pin:', error)
      toast.error(error instanceof Error ? error.message : 'No se pudo guardar la clave')
    } finally {
      setWorking(null)
    }
  }

  const regenerateGeneral = async () => {
    setWorking('general')
    try {
      const res = await fetch('/api/admin/driver-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: 'all' }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'error')
      setGeneralToken(data.token)
      toast.success('Link general regenerado — el anterior dejó de funcionar')
    } catch (error) {
      console.error('Error regenerating general link:', error)
      toast.error(error instanceof Error ? error.message : 'No se pudo regenerar')
    } finally {
      setWorking(null)
    }
  }

  return (
    <Card className="p-6">
      <div className="flex items-start gap-3 mb-4">
        <div className="p-2 rounded-full bg-secondary-50">
          <Link2 className="w-5 h-5 text-secondary-600" />
        </div>
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Acceso Choferes</h3>
          <p className="text-sm text-gray-600">
            Un link por camión: cada chofer ve <strong>solo los trabajos de su camión</strong> de
            los próximos 4 días, sin precios. Cada link pide su propia clave, que puedes cambiar
            acá abajo; una vez que la escribe, <strong>no se la vuelve a pedir por 30 días</strong>.
            «Copiar acceso» y «WhatsApp» mandan el link y la clave juntos.
          </p>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-gray-500">Cargando…</p>
      ) : vehicles.length === 0 ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Todavía no hay camiones cargados. Agrégalos en <strong>Gestión de Flota</strong> y
          después generá el link de cada uno.
        </p>
      ) : (
        <div className="space-y-4">
          {vehicles.map((vehicle, i) => {
            const color = resolveVehicleColor(vehicle, i)
            const link = linkFor(vehicle.token)
            const label = vehicle.driver ? `${vehicle.name} · ${vehicle.driver}` : vehicle.name
            const busyLink = working === String(vehicle.id)
            const busyPin = working === `pin-${vehicle.id}`
            const draft = pinDrafts[vehicle.id] ?? ''
            const dirty = draft.trim() !== (vehicle.usesGeneralPin ? '' : vehicle.pin)

            return (
              <div
                key={vehicle.id}
                className="rounded-lg border border-l-4 border-gray-200 bg-white p-4"
                style={{ borderLeftColor: color.hex }}
              >
                <div className="mb-3 flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-gray-900">{label}</span>
                  {vehicle.status === 'maintenance' && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                      En mantenimiento
                    </span>
                  )}
                </div>

                {vehicle.token ? (
                  <div className="space-y-2">
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <input
                        type="text"
                        readOnly
                        value={link}
                        onFocus={(e) => e.target.select()}
                        className="flex-1 rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-700"
                      />
                      <div className="flex gap-2">
                        <Button
                          onClick={() =>
                            copy(
                              driverAccessMessage(label, link, vehicle.pin),
                              'Link y clave copiados'
                            )
                          }
                          variant="outline"
                          size="sm"
                          title="Copia el mensaje completo: link y clave, listo para pegar donde sea"
                        >
                          <Copy className="mr-2 h-4 w-4" />
                          Copiar acceso
                        </Button>
                        <a
                          href={waHref(link, label, vehicle.pin)}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <Button
                            variant="outline"
                            size="sm"
                            className="border-green-300 text-green-700 hover:bg-green-50"
                          >
                            <MessageCircle className="mr-2 h-4 w-4" />
                            WhatsApp
                          </Button>
                        </a>
                        <Button
                          onClick={() => generate(vehicle)}
                          variant="outline"
                          size="sm"
                          disabled={busyLink}
                          title="Genera un link nuevo para este camión. El anterior deja de funcionar."
                        >
                          <RefreshCw className="mr-2 h-4 w-4" />
                          Regenerar
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <Button onClick={() => generate(vehicle)} size="sm" disabled={busyLink}>
                    <Link2 className="mr-2 h-4 w-4" />
                    Generar link de {vehicle.name}
                  </Button>
                )}

                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
                  <KeyRound className="h-4 w-4 text-gray-400" />
                  <label className="text-xs font-medium text-gray-600" htmlFor={`pin-${vehicle.id}`}>
                    Clave
                  </label>
                  <input
                    id={`pin-${vehicle.id}`}
                    type="text"
                    inputMode="numeric"
                    maxLength={8}
                    value={draft}
                    placeholder={vehicle.usesGeneralPin ? `${generalPin} (general)` : ''}
                    onChange={(e) =>
                      setPinDrafts((prev) => ({
                        ...prev,
                        [vehicle.id]: e.target.value.replace(/\D/g, ''),
                      }))
                    }
                    className="w-28 rounded-lg border border-gray-300 px-3 py-1.5 text-sm tracking-widest text-gray-900 focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-200"
                  />
                  <Button
                    onClick={() => savePin(vehicle)}
                    variant="outline"
                    size="sm"
                    disabled={busyPin || !dirty}
                  >
                    <Check className="mr-2 h-4 w-4" />
                    Guardar
                  </Button>
                  <span className="text-xs text-gray-500">
                    {vehicle.usesGeneralPin
                      ? 'Usa la clave general. Escribe una de 4 a 8 dígitos para darle la suya.'
                      : 'Vacía el campo y guarda para volver a la clave general.'}
                  </span>
                </div>
              </div>
            )
          })}

          <p className="text-xs text-gray-500">
            Cualquiera con el link de un camión ve los nombres y direcciones de ese camión. Si se
            filtra, regenéralo: solo se corta ese link.
          </p>

          {generalToken && (
            <details className="rounded-lg border border-gray-200 bg-gray-50 p-3">
              <summary className="cursor-pointer text-xs font-semibold text-gray-600">
                Link general anterior (muestra todos los camiones)
              </summary>
              <p className="mt-2 text-xs text-gray-500">
                Es el link único que se usaba antes. Sigue funcionando con la clave general (
                <strong>{generalPin}</strong>) para que nadie quede afuera mientras repartís los
                links nuevos. Cuando todos los choferes tengan el suyo, regenéralo una vez y no
                lo compartas: así queda fuera de circulación.
              </p>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                <input
                  type="text"
                  readOnly
                  value={linkFor(generalToken)}
                  onFocus={(e) => e.target.select()}
                  className="flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700"
                />
                <div className="flex gap-2">
                  <Button onClick={() => copy(linkFor(generalToken))} variant="outline" size="sm">
                    <Copy className="mr-2 h-4 w-4" />
                    Copiar
                  </Button>
                  <Button
                    onClick={regenerateGeneral}
                    variant="outline"
                    size="sm"
                    disabled={working === 'general'}
                  >
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Regenerar
                  </Button>
                </div>
              </div>
            </details>
          )}
        </div>
      )}
    </Card>
  )
}
