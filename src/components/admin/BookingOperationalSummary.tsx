'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import toast from 'react-hot-toast'
import { MapPin, Package, Users, Truck, CalendarClock, Wallet, ClipboardList } from 'lucide-react'
import { UNASSIGNED_COLOR, type VehicleColor } from '@/lib/vehicleColors'
import { normalizeStops, formatStopAddress } from '@/lib/stops'
import BookingWorkers from './BookingWorkers'

/**
 * Resumen operacional de una reserva: lo que hay que saber para acomodar el trabajo, en una
 * sola pantalla. Responde, en este orden: dónde empieza y termina, qué distancia, cuántos
 * m³, cuánta gente y quiénes, qué camión, cuándo y cuánto dura, cuánto vale y qué
 * indicaciones tiene.
 *
 * Todo sale de datos que ya existían (la reserva y su cotización); lo único nuevo es poder
 * poner a mano las personas requeridas, porque las reservas cargadas a mano no traen
 * cotización. El camión se cambia acá mismo, sin abrir «Editar».
 */

export interface OperationalBooking {
  id: string
  quote_id?: string | null
  client_name?: string | null
  client_phone?: string | null
  client_email?: string | null
  booking_type?: string | null
  scheduled_date: string
  scheduled_time?: string | null
  duration_hours?: number | null
  status?: string | null
  vehicle_id?: number | null
  origin_address?: string | null
  destination_address?: string | null
  visit_address?: string | null
  origin_floor?: number | null
  origin_has_elevator?: boolean | null
  destination_floor?: number | null
  destination_has_elevator?: boolean | null
  origin_parking_distance?: number | null
  destination_parking_distance?: number | null
  total_weight?: number | string | null
  total_distance?: number | string | null
  recommended_vehicle?: string | null
  items_summary?: Array<{ quantity?: number | string }> | null
  additional_services?: Record<string, any> | null
  stops?: unknown
  notes?: string | null
  payment_type?: string | null
}

interface VehicleOption {
  id: number
  name: string
  driver?: string
  status?: string
  color: VehicleColor
}

interface SlotStatus {
  id: number
  name: string
  status: 'active' | 'maintenance'
  overlapping: { id: string; from: string; to: string }[]
  jobsThatDay: number
  available: boolean
}

interface OperationalData {
  peopleAvailable: boolean
  peopleOverride: number | null
  volumeOverride?: number | null
  distanceOverride?: number | null
  team: { id: string; name: string; phone: string | null; via: 'cuadrilla' | 'camion' }[]
  vehicles: SlotStatus[]
  recommendedVehicleId: number | null
}

const clp = (n: number) => `$${Math.round(n).toLocaleString('es-CL')}`
const num = (v: unknown): number | null => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}

const SERVICE_LABELS: [string, string][] = [
  ['packing', 'Embalaje / armado de cajas'],
  ['unpacking', 'Desembalaje'],
  ['disassembly', 'Desarme de muebles'],
  ['assembly', 'Armado de muebles'],
  ['fridgeDisassembly', 'Desarmado de refrigerador'],
  ['priority', 'Priority · agenda libre'],
]

function Group({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <h4 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-gray-500">
        {icon}
        {title}
      </h4>
      <dl className="space-y-2.5">{children}</dl>
    </section>
  )
}

function Row({ label, children, strong }: { label: string; children: ReactNode; strong?: boolean }) {
  return (
    <div className="grid grid-cols-[120px_1fr] items-start gap-3">
      <dt className="pt-0.5 text-xs text-gray-500">{label}</dt>
      <dd className={`min-w-0 text-sm ${strong ? 'font-semibold text-gray-900' : 'text-gray-800'}`}>{children}</dd>
    </div>
  )
}

const missing = <span className="text-gray-400">Sin dato</span>

/**
 * Acceso a un punto de la ruta: piso, ascensor o escaleras, y metros desde el
 * estacionamiento. «Escaleras» es lo que más le cambia el día al equipo, así que va como
 * fila propia y en rojo cuando no hay ascensor.
 */
function accessInfo(floor?: number | null, elevator?: boolean | null, parking?: number | null): { node: ReactNode; stairs: boolean } {
  const hasFloor = typeof floor === 'number' && floor > 0
  const stairs = hasFloor && elevator === false
  const parkingText = typeof parking === 'number' && parking > 0 ? `${parking} m del estacionamiento a la puerta` : null
  if (!hasFloor && floor !== 0 && !parkingText) return { node: <span className="text-gray-400">Sin dato de piso</span>, stairs: false }
  return {
    stairs,
    node: (
      <>
        {stairs ? (
          <span className="rounded-md bg-red-50 px-2 py-0.5 font-semibold text-red-700">
            Piso {floor} · SIN ascensor: por escaleras
          </span>
        ) : hasFloor ? (
          <span className={elevator === true ? 'text-gray-800' : 'font-semibold text-amber-700'}>
            Piso {floor} · {elevator === true ? 'con ascensor' : 'no se sabe si hay ascensor'}
          </span>
        ) : floor === 0 ? (
          <span>Primer piso / nivel de calle</span>
        ) : null}
        {parkingText && <span className="mt-0.5 block text-xs text-gray-500">{parkingText}</span>}
      </>
    ),
  }
}

export default function BookingOperationalSummary({
  booking,
  fleet,
  volumeM3,
  price,
  paid,
  pending,
  statusLabel,
  onVehicleChanged,
}: {
  booking: OperationalBooking
  fleet: VehicleOption[]
  volumeM3?: number
  price: number
  paid: number
  pending: number
  statusLabel: string
  /** El camión cambió: el que llama actualiza su lista. */
  onVehicleChanged: (vehicleId: number | null) => void
}) {
  const [data, setData] = useState<OperationalData | null>(null)
  const [vehicleId, setVehicleId] = useState<number | null>(booking.vehicle_id ?? null)
  const [savingVehicle, setSavingVehicle] = useState(false)
  const [peopleDraft, setPeopleDraft] = useState<string | null>(null)
  const [savingPeople, setSavingPeople] = useState(false)
  /** Volumen o distancia que se está corrigiendo a mano. */
  const [manualDraft, setManualDraft] = useState<{ field: 'volumeM3' | 'distanceKm'; value: string } | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/bookings/${booking.id}/operational`)
      if (!res.ok) return
      const body = await res.json()
      setData(body)
      // El reparto automático puede haberle puesto camión recién al mirar.
      if (typeof body.vehicleId === 'number' || body.vehicleId === null) setVehicleId(body.vehicleId)
    } catch {
      /* el resumen se muestra igual con lo que trae la reserva */
    }
  }, [booking.id])

  useEffect(() => {
    setData(null)
    setVehicleId(booking.vehicle_id ?? null)
    setPeopleDraft(null)
    setManualDraft(null)
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booking.id])

  const isVisit = booking.booking_type === 'domicilio' || String(booking.quote_id || '').startsWith('DOMICILIO-')
  const svc = booking.additional_services || {}
  const stops = normalizeStops(booking.stops)

  // ── Escaleras ──
  const originAccess = accessInfo(booking.origin_floor, booking.origin_has_elevator, booking.origin_parking_distance)
  const destinationAccess = accessInfo(booking.destination_floor, booking.destination_has_elevator, booking.destination_parking_distance)
  const stairsAt = [originAccess.stairs ? `origen piso ${booking.origin_floor}` : '', destinationAccess.stairs ? `destino piso ${booking.destination_floor}` : ''].filter(Boolean)
  // Marcado por el cliente al cotizar: bultos grandes que van por escalera aunque haya ascensor.
  const bulkyByStairs = Boolean((booking.additional_services || {}).stairsCarry)

  // ── Recursos ──
  const fromQuote = num(svc.totalCrew)
  const people = data?.peopleOverride ?? fromQuote
  const helpers = people !== null ? Math.max(0, people - 1) : null
  const extraHelpers = num(svc.extraHelpers)
  const team = data?.team || []
  const vehicle = vehicleId !== null ? fleet.find((v) => v.id === vehicleId) : undefined
  const color = vehicle?.color || UNASSIGNED_COLOR
  const slot = data?.vehicles.find((v) => v.id === vehicleId)

  // ── Operación ──
  const start = /^(\d{1,2}):(\d{2})/.exec(String(booking.scheduled_time || ''))
  const hours = num(booking.duration_hours)
  let endTime: string | null = null
  if (start && hours) {
    const minutes = Number(start[1]) * 60 + Number(start[2]) + Math.round(hours * 60)
    endTime = minutes < 24 * 60 ? `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}` : null
  }
  const [y, m, d] = booking.scheduled_date.split('-').map(Number)
  const rawDate = new Date(y, (m || 1) - 1, d || 1).toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const dateLabel = rawDate.charAt(0).toUpperCase() + rawDate.slice(1)

  // ── Carga ──
  const units = (booking.items_summary || []).reduce((sum, it) => sum + (Number(it.quantity) || 0), 0)
  const weight = num(booking.total_weight)
  const quoteDistance = num(booking.total_distance)
  const distance = data?.distanceOverride ?? quoteDistance
  const volume = data?.volumeOverride ?? volumeM3
  const services = SERVICE_LABELS.filter(([key]) => svc[key]).map(([, label]) => label)
  const observations = String(svc.observations || '').trim()

  const changeVehicle = async (next: number | null) => {
    if (savingVehicle || next === vehicleId) return
    const previous = vehicleId
    setVehicleId(next)
    setSavingVehicle(true)
    try {
      const res = await fetch(`/api/admin/bookings/${booking.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vehicle_id: next }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || 'No se pudo cambiar el camión')
      const target = data?.vehicles.find((v) => v.id === next)
      if (target && target.overlapping.length > 0) {
        toast(`Camión cambiado. Ojo: ${target.name} ya tiene otro trabajo a esa hora (${target.overlapping.map((o) => `${o.from}–${o.to}`).join(', ')}).`, { icon: '⚠️', duration: 7000 })
      } else {
        toast.success(next === null ? 'Camión quitado: se reparte solo' : 'Camión cambiado')
      }
      onVehicleChanged(next)
      await load()
    } catch (error) {
      setVehicleId(previous)
      toast.error(error instanceof Error ? error.message : 'No se pudo cambiar el camión')
    } finally {
      setSavingVehicle(false)
    }
  }

  const savePeople = async () => {
    if (peopleDraft === null || savingPeople) return
    setSavingPeople(true)
    try {
      const res = await fetch(`/api/admin/bookings/${booking.id}/operational`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ peopleNeeded: peopleDraft.trim() === '' ? null : Number(peopleDraft) }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || 'No se pudo guardar')
      setData((prev) => prev && { ...prev, peopleOverride: body.peopleOverride })
      setPeopleDraft(null)
      toast.success('Personas requeridas guardadas')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo guardar')
    } finally {
      setSavingPeople(false)
    }
  }

  const saveManual = async () => {
    if (!manualDraft || savingPeople) return
    setSavingPeople(true)
    try {
      const res = await fetch(`/api/admin/bookings/${booking.id}/operational`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [manualDraft.field]: manualDraft.value.trim() === '' ? null : manualDraft.value }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || 'No se pudo guardar')
      setData((prev) => prev && { ...prev, volumeOverride: body.volumeOverride, distanceOverride: body.distanceOverride })
      setManualDraft(null)
      toast.success('Dato guardado')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo guardar')
    } finally {
      setSavingPeople(false)
    }
  }

  /** Editor en línea de volumen o distancia; null si ese campo no se está editando. */
  const manualEditor = (field: 'volumeM3' | 'distanceKm') =>
    manualDraft?.field === field ? (
      <span className="flex flex-wrap items-center gap-2 font-normal">
        <input
          type="number"
          min={0}
          step={0.1}
          autoFocus
          value={manualDraft.value}
          onChange={(e) => setManualDraft({ field, value: e.target.value })}
          className="w-24 rounded-lg border border-gray-300 px-2 py-1 text-sm"
        />
        <span className="text-sm text-gray-600">{field === 'volumeM3' ? 'm³' : 'km'}</span>
        <button type="button" disabled={savingPeople} onClick={saveManual} className="text-sm font-semibold text-primary-600 hover:underline">
          Guardar
        </button>
        <button type="button" onClick={() => setManualDraft(null)} className="text-sm text-gray-500">
          Cancelar
        </button>
      </span>
    ) : null

  const manualLink = (field: 'volumeM3' | 'distanceKm', hasValue: boolean, override: number | null) => (
    <>
      <button
        type="button"
        onClick={() => setManualDraft({ field, value: override != null ? String(override) : '' })}
        className="ml-2 text-xs font-semibold text-primary-600 hover:underline"
      >
        {hasValue ? 'Cambiar' : 'Indicar'}
      </button>
      {override != null && <span className="ml-1 text-xs font-normal text-gray-500">(puesto a mano)</span>}
    </>
  )

  const headline: string[] = [
    distance ? `${distance.toLocaleString('es-CL', { maximumFractionDigits: 1 })} km` : '',
    volume != null ? `${volume.toFixed(1)} m³` : '',
    people !== null ? `${people} persona${people === 1 ? '' : 's'}` : team.length > 0 ? `${team.length} asignado${team.length === 1 ? '' : 's'}` : '',
    vehicle?.name || 'Sin camión',
    hours ? `${hours} h${start ? ` (${String(booking.scheduled_time).slice(0, 5)}${endTime ? `–${endTime}` : ''})` : ''}` : '',
    price > 0 ? clp(price) : '',
  ].filter(Boolean)

  return (
    <div className="space-y-4">
      {/* De un vistazo: distancia · volumen · personas · camión · duración · valor */}
      <div className="rounded-xl bg-gray-900 px-5 py-4 text-white">
        <p className="text-lg font-bold">{booking.client_name || 'Sin nombre'}</p>
        <p className="mt-0.5 text-sm text-gray-300">
          {[booking.client_phone, booking.client_email, booking.quote_id].filter(Boolean).join(' · ')}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {headline.map((item) => (
            <span key={item} className="rounded-full bg-white/10 px-3 py-1 text-sm font-semibold">
              {item}
            </span>
          ))}
          {!isVisit && stairsAt.length > 0 && (
            <span className="rounded-full bg-red-500 px-3 py-1 text-sm font-bold text-white">Escaleras: {stairsAt.join(' y ')}</span>
          )}
          {!isVisit && bulkyByStairs && (
            <span className="rounded-full bg-red-500 px-3 py-1 text-sm font-bold text-white">Muebles grandes por escalera</span>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Group icon={<MapPin className="h-4 w-4" />} title="Ruta">
          {isVisit && booking.visit_address ? (
            <Row label="Visita" strong>
              {booking.visit_address}
            </Row>
          ) : (
            <>
              <Row label="Origen" strong>
                {booking.origin_address || missing}
              </Row>
              <Row label="Acceso origen">{originAccess.node}</Row>
              {stops.length > 0 && (
                <Row label={`Paradas (${stops.length})`}>
                  <ol className="space-y-1">
                    {stops.map((stop, i) => (
                      <li key={i}>
                        {i + 1}. {formatStopAddress(stop)}
                        {stop.note ? <span className="block text-xs text-gray-500">{stop.note}</span> : null}
                      </li>
                    ))}
                  </ol>
                </Row>
              )}
              <Row label="Destino" strong>
                {booking.destination_address || missing}
              </Row>
              <Row label="Acceso destino">{destinationAccess.node}</Row>
            </>
          )}
          {bulkyByStairs && (
            <Row label="Escaleras">
              <span className="rounded-md bg-red-50 px-2 py-0.5 font-semibold text-red-700">
                Hay muebles grandes que no caben en el ascensor: van por la escalera
              </span>
              <span className="mt-0.5 block text-xs text-gray-500">Lo marcó el cliente al cotizar.</span>
            </Row>
          )}
          <Row label="Distancia">
            {manualEditor('distanceKm') || (
              <>
                {distance ? `${distance.toLocaleString('es-CL', { maximumFractionDigits: 1 })} km` : missing}
                {manualLink('distanceKm', distance != null, data?.distanceOverride ?? null)}
              </>
            )}
          </Row>
        </Group>

        <Group icon={<Users className="h-4 w-4" />} title="Recursos">
          <Row label="Personas" strong>
            {peopleDraft !== null ? (
              <span className="flex flex-wrap items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={20}
                  autoFocus
                  value={peopleDraft}
                  onChange={(e) => setPeopleDraft(e.target.value)}
                  placeholder={fromQuote ? String(fromQuote) : ''}
                  className="w-20 rounded-lg border border-gray-300 px-2 py-1 text-sm"
                />
                <button type="button" disabled={savingPeople} onClick={savePeople} className="text-sm font-semibold text-primary-600 hover:underline">
                  Guardar
                </button>
                <button type="button" onClick={() => setPeopleDraft(null)} className="text-sm font-normal text-gray-500">
                  Cancelar
                </button>
              </span>
            ) : (
              <>
                {people !== null ? `${people} en total` : missing}
                {people !== null && (
                  <span className="font-normal text-gray-600">
                    {' '}
                    · chofer + {helpers} peoneta{helpers === 1 ? '' : 's'}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setPeopleDraft(data?.peopleOverride != null ? String(data.peopleOverride) : '')}
                  className="ml-2 text-xs font-semibold text-primary-600 hover:underline"
                >
                  {people !== null ? 'Cambiar' : 'Indicar'}
                </button>
                <span className="mt-0.5 block text-xs font-normal text-gray-500">
                  {data?.peopleOverride != null
                    ? `Puesto a mano${fromQuote ? ` (la cotización pedía ${fromQuote})` : ''}.`
                    : fromQuote
                      ? `Según la cotización${extraHelpers ? `, con ${extraHelpers} ayudante${extraHelpers === 1 ? '' : 's'} extra pedido${extraHelpers === 1 ? '' : 's'} por el cliente` : ''}.`
                      : 'Esta reserva no trae cotización: indícalo a mano.'}
                </span>
              </>
            )}
          </Row>
          <Row label="Cuadrilla">
            {team.length === 0 ? (
              <span className="font-semibold text-amber-700">Nadie asignado</span>
            ) : (
              <>
                <span className="font-semibold text-gray-900">
                  {team.length} asignado{team.length === 1 ? '' : 's'}
                </span>
                {people !== null && team.length < people && (
                  <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                    faltan {people - team.length}
                  </span>
                )}
                <span className="mt-0.5 block text-gray-700">
                  {team.map((w) => `${w.name}${w.via === 'camion' ? ' (por camión)' : ''}`).join(', ')}
                </span>
              </>
            )}
          </Row>
          <Row label="Camión" strong>
            <span className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-semibold" style={{ backgroundColor: color.soft, color: color.ink }}>
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color.hex }} aria-hidden />
                {vehicle ? vehicle.name : 'Sin asignar'}
              </span>
              <select
                value={vehicleId ?? ''}
                disabled={savingVehicle}
                onChange={(e) => changeVehicle(e.target.value === '' ? null : Number(e.target.value))}
                aria-label="Cambiar camión"
                className="rounded-lg border border-gray-300 bg-white px-2 py-1 text-sm font-normal text-gray-800 disabled:opacity-60"
              >
                <option value="">Sin camión (se reparte solo)</option>
                {fleet.map((v) => {
                  const s = data?.vehicles.find((x) => x.id === v.id)
                  const busy = s && s.overlapping.length > 0 && v.id !== vehicleId
                  return (
                    <option key={v.id} value={v.id} disabled={v.status === 'maintenance'}>
                      {v.name}
                      {v.driver ? ` · ${v.driver}` : ''}
                      {v.status === 'maintenance' ? ' (en mantención)' : busy ? ` · ocupado ${s!.overlapping.map((o) => `${o.from}–${o.to}`).join(', ')}` : s ? ' · libre' : ''}
                    </option>
                  )
                })}
              </select>
            </span>
            {slot && slot.overlapping.length > 0 && (
              <span className="mt-1 block text-xs font-semibold text-red-600">
                Se pisa con otro trabajo de este camión ({slot.overlapping.map((o) => `${o.from}–${o.to}`).join(', ')}).
              </span>
            )}
            {booking.recommended_vehicle && (
              <span className="mt-1 block text-xs font-normal text-gray-500">La cotización recomendó: {booking.recommended_vehicle}</span>
            )}
          </Row>
        </Group>

        <Group icon={<Package className="h-4 w-4" />} title="Carga">
          <Row label="Volumen" strong>
            {manualEditor('volumeM3') || (
              <>
                {volume != null ? `${volume.toFixed(2)} m³` : missing}
                {units > 0 && <span className="font-normal text-gray-600"> · {units} bulto{units === 1 ? '' : 's'}</span>}
                {manualLink('volumeM3', volume != null, data?.volumeOverride ?? null)}
              </>
            )}
          </Row>
          <Row label="Peso">{weight ? `${weight.toLocaleString('es-CL', { maximumFractionDigits: 0 })} kg` : missing}</Row>
          <Row label="Tipo">{isVisit ? 'Cotización a domicilio' : 'Mudanza'}</Row>
          <Row label="Servicios">{services.length > 0 ? services.join(' · ') : <span className="text-gray-500">Solo traslado</span>}</Row>
        </Group>

        <Group icon={<CalendarClock className="h-4 w-4" />} title="Operación">
          <Row label="Fecha" strong>
            {dateLabel}
          </Row>
          <Row label="Hora" strong>
            {start ? String(booking.scheduled_time).slice(0, 5) : missing}
            {endTime && <span className="font-normal text-gray-600"> a {endTime}</span>}
          </Row>
          <Row label="Duración">{hours ? `${hours} h estimadas` : missing}</Row>
          <Row label="Estado">{statusLabel}</Row>
        </Group>

        <Group icon={<Wallet className="h-4 w-4" />} title="Comercial">
          <Row label="Valor" strong>
            {price > 0 ? clp(price) : missing}
          </Row>
          <Row label="Pagado">
            <span className="font-semibold text-green-700">{clp(paid)}</span>
          </Row>
          <Row label="Saldo">
            <span className={`font-semibold ${pending > 0 ? 'text-orange-700' : 'text-green-700'}`}>{clp(pending)}</span>
          </Row>
          {booking.payment_type && (
            <Row label="Forma de pago">
              <span className="capitalize">{booking.payment_type}</span>
            </Row>
          )}
        </Group>

        <Group icon={<ClipboardList className="h-4 w-4" />} title="Indicaciones">
          <Row label="Del cliente">{observations ? <span className="whitespace-pre-line">{observations}</span> : <span className="text-gray-500">Ninguna</span>}</Row>
          <Row label="Notas internas">{booking.notes ? <span className="whitespace-pre-line">{booking.notes}</span> : <span className="text-gray-500">Ninguna</span>}</Row>
        </Group>
      </div>

      {/* Asignar la cuadrilla acá mismo: al cambiarla se vuelve a leer quiénes van. */}
      <BookingWorkers bookingId={booking.id} onChange={load} />
      <p className="flex items-center gap-1.5 text-xs text-gray-500">
        <Truck className="h-3.5 w-3.5" />
        Cambiar el camión o la cuadrilla queda en Actividad y le avisa a los trabajadores.
      </p>
    </div>
  )
}
