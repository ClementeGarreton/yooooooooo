'use client'

import { useCallback, useEffect, useState } from 'react'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import { Inbox } from 'lucide-react'
import toast from 'react-hot-toast'
import { formatRut } from '@/lib/rut'
import { SERVICE_TYPE_LABEL, type ServiceRequestView } from '@/lib/serviceRequestTypes'
import { MODIFICATION_FIELD_LABEL, type AdminModification } from '@/lib/bookingModificationTypes'

/**
 * Bandeja «Por aprobar» del admin (Módulos 3 y 4): lo que espera una decisión.
 *
 *  - SOLICITUDES de clientes y empresas. «Aprobar y agendar» lleva a la «Nueva reserva» de
 *    siempre con los datos de la solicitud; ahí se le pone precio y al guardar queda
 *    aprobada. «Rechazar» pide un motivo, que el cliente lee en su panel.
 *  - MODIFICACIONES EN TERRENO que registra el equipo (4 bultos cotizados, 5 encontrados).
 *    Quien aprueba fija el ajuste de precio —puede ser $0—; nada cambia en la reserva sin
 *    esa aprobación y el dato cotizado queda guardado.
 */

const clp = (n: number) => `$${Math.round(n).toLocaleString('es-CL')}`

const fmtDate = (d: string) => {
  const [y, m, day] = d.slice(0, 10).split('-')
  return `${day}-${m}-${y}`
}

function ago(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (minutes < 60) return `hace ${minutes} min`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `hace ${hours} h`
  const days = Math.round(hours / 24)
  return `hace ${days} día${days === 1 ? '' : 's'}`
}

function when(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleString('es-CL', {
    timeZone: 'America/Santiago',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function ApprovalsInbox({
  onApprove,
  onOpenBooking,
  onPendingCount,
}: {
  /** Abre «Nueva reserva» con los datos de la solicitud. */
  onApprove: (request: ServiceRequestView) => void
  /** Lleva a la reserva que nació de una solicitud ya aprobada. */
  onOpenBooking: (quoteId: string) => void
  onPendingCount?: (count: number) => void
}) {
  const [requests, setRequests] = useState<ServiceRequestView[]>([])
  const [modifications, setModifications] = useState<AdminModification[]>([])
  // Lo resuelto va plegado al final: lo visible es lo que espera una decisión.
  const [showResolved, setShowResolved] = useState(false)
  const [selectedModId, setSelectedModId] = useState<string | null>(null)
  /** Ajuste de precio que se está escribiendo para la modificación abierta. */
  const [delta, setDelta] = useState('')
  const [available, setAvailable] = useState(true)
  const [modsAvailable, setModsAvailable] = useState(true)
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const [res, modRes] = await Promise.all([
        fetch('/api/admin/service-requests'),
        fetch('/api/admin/modifications'),
      ])
      // 403 = el perfil no tiene ese subpanel (solicitudes o diferencias): esa lista queda
      // vacía y la otra se muestra igual.
      const data = res.status === 403 ? { requests: [], pending: 0 } : await res.json().catch(() => ({}))
      const modData = modRes.status === 403 ? { modifications: [], pending: 0 } : await modRes.json().catch(() => ({}))
      if ((!res.ok && res.status !== 403) || (!modRes.ok && modRes.status !== 403)) throw new Error(data?.error || modData?.error || 'Error')
      setAvailable(data.available !== false)
      setRequests(data.requests || [])
      setModifications(modData.modifications || [])
      setModsAvailable(modData.available !== false)
      onPendingCount?.((data.pending || 0) + (modData.pending || 0))
      // Al abrir, lo primero pendiente: una modificación (el equipo está en terreno
      // esperando) antes que una solicitud.
      const firstMod = (modData.modifications || []).find((m: AdminModification) => m.status === 'pendiente')
      setSelectedModId((current) => current ?? firstMod?.id ?? null)
      setSelectedId((current) => current ?? (firstMod ? null : data.requests?.[0]?.id ?? null))
    } catch {
      toast.error('No se pudieron cargar las solicitudes')
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const selectedMod = modifications.find((m) => m.id === selectedModId) || null
  const selected = selectedMod ? null : requests.find((r) => r.id === selectedId) || null
  const pending = requests.filter((r) => r.status === 'pendiente')
  const resolved = requests.filter((r) => r.status !== 'pendiente')
  const pendingMods = modifications.filter((m) => m.status === 'pendiente')
  const resolvedMods = modifications.filter((m) => m.status !== 'pendiente')

  const deltaValue = Number(delta.replace(/[^\d-]/g, '')) || 0

  const resolveMod = async (action: 'approve' | 'reject') => {
    if (!selectedMod || busy) return
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/modifications/${selectedMod.id}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, priceDelta: deltaValue, note: reason }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'No se pudo resolver')
      toast.success(action === 'approve' ? 'Modificación aprobada' : 'Modificación rechazada')
      setRejecting(false)
      setReason('')
      setDelta('')
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo resolver')
    } finally {
      setBusy(false)
    }
  }

  const reject = async () => {
    if (!selected || busy) return
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/service-requests/${selected.id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'No se pudo rechazar')
      toast.success('Solicitud rechazada')
      setRejecting(false)
      setReason('')
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo rechazar')
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary-600" />
      </div>
    )
  }

  const item = (r: ServiceRequestView) => (
    <button
      key={r.id}
      type="button"
      onClick={() => {
        setSelectedId(r.id)
        setSelectedModId(null)
        setRejecting(false)
        setReason('')
      }}
      className={`w-full rounded-xl border bg-white p-4 text-left transition ${
        !selectedMod && selectedId === r.id ? 'border-primary-500 ring-1 ring-primary-500' : 'border-gray-200 hover:border-gray-300'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-bold uppercase tracking-wide text-primary-700">
          Solicitud · {SERVICE_TYPE_LABEL[r.serviceType]}
          {r.isPriority && <span className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-amber-800">Prioritaria</span>}
        </span>
        <span className="text-xs text-gray-400">{ago(r.createdAt)}</span>
      </div>
      <p className="mt-1 truncate text-sm font-semibold text-gray-900">
        {r.origin} → {r.destination}
      </p>
      <p className="text-xs text-gray-500">
        {r.company?.razon_social || r.customer.name || r.customer.email}
        {r.status === 'aprobada' ? ' · Aprobada' : r.status === 'rechazada' ? ' · Rechazada' : ''}
      </p>
    </button>
  )

  const modItem = (m: AdminModification) => (
    <button
      key={m.id}
      type="button"
      onClick={() => {
        setSelectedModId(m.id)
        setRejecting(false)
        setReason('')
        setDelta('')
      }}
      className={`w-full rounded-xl border bg-white p-4 text-left transition ${
        selectedModId === m.id ? 'border-primary-500 ring-1 ring-primary-500' : 'border-gray-200 hover:border-gray-300'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-bold uppercase tracking-wide text-amber-700">Modificación en terreno</span>
        <span className="text-xs text-gray-400">{ago(m.createdAt)}</span>
      </div>
      <p className="mt-1 truncate text-sm font-semibold text-gray-900">
        {m.booking?.code || 'Reserva'} · {MODIFICATION_FIELD_LABEL[m.field]} {m.originalValue} → {m.foundValue}
      </p>
      <p className="text-xs text-gray-500">
        Registrada por {m.workerLabel}
        {m.status === 'aprobada' ? ' · Aprobada' : m.status === 'rechazada' ? ' · Rechazada' : ''}
      </p>
    </button>
  )

  const totalPending = pending.length + pendingMods.length

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Por aprobar</h2>
          <p className="text-gray-600">Solicitudes y cambios en terreno que esperan tu decisión.</p>
        </div>
        <span className="rounded-full bg-amber-50 px-3 py-1 text-sm font-semibold text-amber-700">
          {totalPending} pendiente{totalPending === 1 ? '' : 's'}
        </span>
      </div>

      {!modsAvailable && (
        <Card className="p-4">
          <p className="text-sm text-gray-600">
            Para recibir modificaciones en terreno falta correr la migración{' '}
            <code>database/migrations/add_booking_modifications.sql</code>.
          </p>
        </Card>
      )}

      {!available ? (
        <Card className="p-6">
          <p className="text-sm text-gray-600">
            Falta correr la migración <code>database/migrations/add_service_requests.sql</code> para habilitar las
            solicitudes.
          </p>
        </Card>
      ) : requests.length === 0 && modifications.length === 0 ? (
        <Card className="py-12 text-center">
          <Inbox className="mx-auto mb-4 h-12 w-12 text-gray-400" />
          <p className="text-gray-600">No hay solicitudes ni modificaciones todavía.</p>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-5">
          <div className="space-y-3 lg:col-span-2">
            {totalPending === 0 && <p className="text-sm text-gray-500">Nada pendiente.</p>}
            {pendingMods.map(modItem)}
            {pending.map(item)}
            {(resolved.length > 0 || resolvedMods.length > 0) && (
              <>
                <button
                  type="button"
                  onClick={() => setShowResolved(!showResolved)}
                  className="pt-3 text-xs font-bold uppercase tracking-wide text-gray-400 hover:text-gray-600"
                  aria-expanded={showResolved}
                >
                  {showResolved ? 'Ocultar resueltas' : `Ver resueltas recientes (${resolved.length + resolvedMods.length})`}
                </button>
                {showResolved && resolvedMods.map(modItem)}
                {showResolved && resolved.map(item)}
              </>
            )}
          </div>

          {selectedMod && (
            <Card className="h-fit p-6 lg:col-span-3">
              <span
                className={`inline-block rounded-full px-3 py-1 text-xs font-bold ${
                  selectedMod.status === 'pendiente'
                    ? 'bg-amber-50 text-amber-700'
                    : selectedMod.status === 'aprobada'
                      ? 'bg-green-50 text-green-700'
                      : 'bg-red-50 text-red-700'
                }`}
              >
                {selectedMod.status === 'pendiente'
                  ? 'Modificación pendiente'
                  : selectedMod.status === 'aprobada'
                    ? 'Modificación aprobada'
                    : 'Modificación rechazada'}
              </span>
              <h3 className="mt-3 text-xl font-bold text-gray-900">
                {selectedMod.booking?.code || 'Reserva'}
                {selectedMod.booking?.origin && selectedMod.booking?.destination
                  ? ` · ${selectedMod.booking.origin} → ${selectedMod.booking.destination}`
                  : ''}
              </h3>
              <p className="text-sm text-gray-600">
                {[
                  selectedMod.booking?.clientName,
                  selectedMod.booking?.scheduledDate ? fmtDate(selectedMod.booking.scheduledDate) : null,
                  selectedMod.booking?.scheduledTime?.slice(0, 5),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>

              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-gray-100 p-4">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-gray-500">Cotizado</p>
                  <p className="mt-1 text-lg font-bold text-gray-900">
                    {selectedMod.originalValue} <span className="text-sm font-medium">{MODIFICATION_FIELD_LABEL[selectedMod.field].toLowerCase()}</span>
                  </p>
                </div>
                <div className="rounded-xl bg-amber-50 p-4">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-amber-700">Encontrado en terreno</p>
                  <p className="mt-1 text-lg font-bold text-amber-900">
                    {selectedMod.foundValue} <span className="text-sm font-medium">{MODIFICATION_FIELD_LABEL[selectedMod.field].toLowerCase()}</span>
                  </p>
                </div>
              </div>
              <p className="mt-3 whitespace-pre-line rounded-lg border-l-4 border-primary-400 bg-gray-50 px-3 py-2 text-sm text-gray-800">
                “{selectedMod.note}”
              </p>

              <dl className="mt-4 divide-y divide-gray-100 text-sm">
                <div className="flex justify-between gap-4 py-2">
                  <dt className="text-gray-500">Registrada por</dt>
                  <dd className="text-right font-medium text-gray-900">
                    {selectedMod.workerLabel} · {when(selectedMod.createdAt)}
                  </dd>
                </div>
                {selectedMod.status === 'pendiente' ? (
                  <>
                    <div className="flex justify-between gap-4 py-2">
                      <dt className="text-gray-500">Precio vigente del servicio</dt>
                      <dd className="font-medium text-gray-900">{clp(selectedMod.booking?.price || 0)}</dd>
                    </div>
                    <div className="flex items-center justify-between gap-4 py-2">
                      <dt className="text-gray-500">Ajuste (pesos; vacío = sin cambio, con «-» rebaja)</dt>
                      <dd>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={delta}
                          onChange={(e) => setDelta(e.target.value)}
                          placeholder="0"
                          className="w-32 rounded-md border border-gray-300 px-3 py-1.5 text-right text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                        />
                      </dd>
                    </div>
                    <div className="flex justify-between gap-4 py-2">
                      <dt className="font-medium text-gray-700">Nuevo total si se aprueba</dt>
                      <dd className="font-bold text-gray-900">{clp((selectedMod.booking?.price || 0) + deltaValue)}</dd>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex justify-between gap-4 py-2">
                      <dt className="text-gray-500">Resuelta por</dt>
                      <dd className="text-right font-medium text-gray-900">
                        {selectedMod.resolvedBy} · {when(selectedMod.resolvedAt)}
                      </dd>
                    </div>
                    {selectedMod.status === 'aprobada' && (
                      <div className="flex justify-between gap-4 py-2">
                        <dt className="text-gray-500">Ajuste aprobado</dt>
                        <dd className="font-medium text-gray-900">
                          {selectedMod.priceDelta
                            ? `${selectedMod.priceDelta > 0 ? '+' : '−'}${clp(Math.abs(selectedMod.priceDelta))} (${clp(selectedMod.priceBefore || 0)} → ${clp(selectedMod.priceAfter || 0)})`
                            : 'Sin cambio de precio'}
                        </dd>
                      </div>
                    )}
                    {selectedMod.resolutionNote && (
                      <div className="py-2 text-gray-700">{selectedMod.resolutionNote}</div>
                    )}
                  </>
                )}
              </dl>

              {selectedMod.status === 'pendiente' &&
                (rejecting ? (
                  <div className="mt-4">
                    <label className="mb-1 block text-sm font-medium text-gray-700">Motivo del rechazo</label>
                    <textarea
                      autoFocus
                      rows={3}
                      maxLength={500}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                    <div className="mt-2 flex justify-end gap-2">
                      <Button variant="outline" onClick={() => setRejecting(false)} disabled={busy}>
                        Volver
                      </Button>
                      <Button
                        onClick={() => resolveMod('reject')}
                        disabled={busy || reason.trim().length < 3}
                        className="bg-red-600 text-white hover:bg-red-700"
                      >
                        {busy ? 'Rechazando...' : 'Rechazar modificación'}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button onClick={() => resolveMod('approve')} disabled={busy}>
                      {busy ? 'Aprobando...' : deltaValue ? `Aprobar con ajuste de ${clp(deltaValue)}` : 'Aprobar sin cambio de precio'}
                    </Button>
                    <Button variant="outline" onClick={() => setRejecting(true)} disabled={busy}>
                      Rechazar
                    </Button>
                  </div>
                ))}

              {selectedMod.booking?.quoteId && (
                <button
                  type="button"
                  onClick={() => onOpenBooking(selectedMod.booking!.quoteId!)}
                  className="mt-4 block text-sm font-semibold text-primary-600 underline underline-offset-2"
                >
                  Abrir la reserva y ver su historial
                </button>
              )}
            </Card>
          )}

          {selected && (
            <Card className="h-fit p-6 lg:col-span-3">
              <span
                className={`inline-block rounded-full px-3 py-1 text-xs font-bold ${
                  selected.status === 'pendiente'
                    ? 'bg-amber-50 text-amber-700'
                    : selected.status === 'aprobada'
                      ? 'bg-green-50 text-green-700'
                      : 'bg-red-50 text-red-700'
                }`}
              >
                {selected.status === 'pendiente' ? 'Solicitud pendiente' : selected.status === 'aprobada' ? 'Aprobada' : 'Rechazada'}
              </span>
              <h3 className="mt-3 text-xl font-bold text-gray-900">
                {selected.code} · {SERVICE_TYPE_LABEL[selected.serviceType]}
              </h3>
              <p className="text-sm text-gray-600">
                {[selected.customer.name, selected.customer.code, selected.customer.email, selected.customer.phone]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              {selected.company && (
                <p className="text-sm font-medium text-gray-800">
                  {selected.company.razon_social} · {selected.company.code} · {formatRut(selected.company.rut)}
                </p>
              )}

              <dl className="mt-4 divide-y divide-gray-100 text-sm">
                {[
                  ['Origen', selected.origin],
                  ['Destino', selected.destination],
                  ['Fecha pedida', `${fmtDate(selected.requestedDate)}${selected.requestedTime ? ` · ${selected.requestedTime.slice(0, 5)}` : ''}`],
                  ['Contacto en origen', selected.contact || '—'],
                  ...(selected.serviceType === 'pallets'
                    ? [
                        ['Pallets', selected.pallets != null ? String(selected.pallets) : 'sin indicar'],
                        ['Repaletizar', selected.repalletize ? 'Sí' : 'No'],
                      ]
                    : [
                        ['Volumen', selected.volumeM3 != null ? `${selected.volumeM3} m³` : '—'],
                        ['Personas', selected.peopleNeeded != null ? String(selected.peopleNeeded) : '—'],
                      ]),
                  ...(selected.isPriority ? [['Tarifa prioritaria', 'Menos de 24 h · aceptada por el cliente']] : []),
                  ...(selected.fixedTime ? [['Horario fijo', 'Sí: hay que estar a esa hora']] : []),
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-4 py-2">
                    <dt className="text-gray-500">{label}</dt>
                    <dd className="text-right font-medium text-gray-900">{value}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-3 whitespace-pre-line rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-800">
                {selected.description}
              </p>

              <div className="mt-5">
                <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Seguimiento</p>
                <ol className="mt-2 space-y-1.5 text-sm">
                  {selected.steps.map((s) => (
                    <li key={s.key} className="flex items-start gap-2">
                      <span
                        className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${
                          !s.done ? 'border border-gray-300' : s.key === 'rechazada' || s.key === 'cancelada' ? 'bg-red-500' : 'bg-green-500'
                        }`}
                      />
                      <span className={s.done ? 'text-gray-900' : 'text-gray-400'}>
                        {s.label}
                        {s.done && (s.at || s.by) && (
                          <span className="text-xs text-gray-500"> · {[when(s.at), s.by].filter(Boolean).join(' · ')}</span>
                        )}
                        {s.detail && <span className="block text-xs text-gray-600">{s.detail}</span>}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>

              {selected.status === 'pendiente' ? (
                rejecting ? (
                  <div className="mt-5">
                    <label className="mb-1 block text-sm font-medium text-gray-700">
                      Motivo del rechazo (el cliente lo lee en su panel)
                    </label>
                    <textarea
                      autoFocus
                      rows={3}
                      maxLength={500}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                    <div className="mt-2 flex justify-end gap-2">
                      <Button variant="outline" onClick={() => setRejecting(false)} disabled={busy}>
                        Volver
                      </Button>
                      <Button onClick={reject} disabled={busy || reason.trim().length < 3} className="bg-red-600 text-white hover:bg-red-700">
                        {busy ? 'Rechazando...' : 'Rechazar solicitud'}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-5 flex flex-wrap gap-2">
                    <Button onClick={() => onApprove(selected)}>Aprobar y agendar</Button>
                    <Button variant="outline" onClick={() => setRejecting(true)}>
                      Rechazar
                    </Button>
                  </div>
                )
              ) : (
                selected.booking?.quoteId && (
                  <div className="mt-5">
                    <Button variant="outline" onClick={() => onOpenBooking(selected.booking!.quoteId!)}>
                      Abrir la reserva {selected.booking.code || ''}
                    </Button>
                  </div>
                )
              )}
            </Card>
          )}
        </div>
      )}
    </div>
  )
}
