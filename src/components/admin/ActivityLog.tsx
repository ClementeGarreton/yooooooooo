'use client'

import PeriodFilter from './PeriodFilter'
import { periodOf, resolvePeriod, type Period } from '@/lib/period'
import { Fragment, useCallback, useEffect, useState } from 'react'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import { History, Download, ChevronDown, ChevronRight, Filter } from 'lucide-react'
import toast from 'react-hot-toast'

interface ActivityEntry {
  id: string
  created_at: string
  actor_username: string
  action: string
  entity_type: string | null
  entity_id: string | null
  entity_label: string | null
  summary: string
  changes: Record<string, { from: unknown; to: unknown }> | null
  ip: string | null
  request_path: string | null
  result: string
}

const PAGE_SIZE = 50

// Etiquetas legibles por acción. Si aparece una nueva sin mapear, se muestra cruda.
const ACTION_LABELS: Record<string, string> = {
  'auth.login': 'Inicio de sesión',
  'auth.login_failed': 'Login fallido',
  'auth.logout': 'Cierre de sesión',
  'booking.created': 'Reserva creada',
  'booking.status_changed': 'Estado de reserva',
  'booking.rescheduled': 'Reserva reprogramada',
  'booking.payment_updated': 'Pago de reserva',
  'booking.payment_registered': 'Pago registrado',
  'booking.amount_adjusted': 'Monto reajustado',
  'booking.balance_link_created': 'Link de pago del saldo',
  'booking.address_changed': 'Dirección cambiada',
  'booking.tax_document_changed': 'Documento tributario',
  'booking.cleanup_deleted': 'Pre-reservas abandonadas borradas',
  'booking.cleanup_rescued': 'Pre-reservas pagadas rescatadas',
  'booking.vehicle_assigned': 'Camión asignado',
  'booking.deleted': 'Reserva eliminada',
  'prospect.status_changed': 'Estado de lead',
  'prospect.updated': 'Lead actualizado',
  'prospect.deleted': 'Lead eliminado',
  'prospect.quote_sent': 'Cotización enviada',
  'prospect.converted_to_booking': 'Lead convertido',
  'prospect.admin_quote_created': 'Cotización del panel',
  'prospect.items_repriced': 'Precios de artículos corregidos',
  'customer.created': 'Cliente creado',
  'customer.origin_changed': 'Origen de cliente',
  'customer.frequent_toggled': 'Cliente frecuente',
  'customer.access_changed': 'Acceso de cliente cambiado',
  'customer.login_link_sent': 'Link de acceso enviado',
  'worker.created': 'Trabajador creado',
  'worker.updated': 'Trabajador editado',
  'worker.deactivated': 'Trabajador desactivado',
  'worker.pin_changed': 'PIN de trabajador cambiado',
  'booking.workers_changed': 'Cuadrilla cambiada',
  'booking.modification_approved': 'Modificación en terreno aprobada',
  'booking.modification_rejected': 'Modificación en terreno rechazada',
  'service_request.approved': 'Solicitud aprobada',
  'service_request.rejected': 'Solicitud rechazada',
  'invoice.previewed': 'Factura previsualizada',
  'invoice.emitted': 'Factura emitida',
  'invoice.emit_attempted': 'Intento de emitir factura',
  'coupon.created': 'Cupón creado',
  'coupon.activated': 'Cupón activado',
  'coupon.deactivated': 'Cupón desactivado',
  'marketing.referrals_updated': 'Programa de referidos',
  'preview.opened': 'Panel visto como la persona',
  'profile.created': 'Perfil creado',
  'profile.updated': 'Perfil editado',
  'company.created': 'Empresa creada',
  'company.updated': 'Empresa editada',
  'company.member_added': 'Persona asociada a empresa',
  'company.member_role_changed': 'Rol en empresa cambiado',
  'company.member_removed': 'Persona quitada de empresa',
  'company.bookings_assigned': 'Reservas asignadas a empresa',
  'company.bookings_unassigned': 'Reservas quitadas de empresa',
  'auth.password_changed': 'Contraseña cambiada',
  'pricing.updated': 'Precios actualizados',
  'schedule.updated': 'Agenda actualizada',
  'fleet.updated': 'Flota actualizada',
  'fleet.vehicle_details_updated': 'Ficha de camión actualizada',
  'driver_link.regenerated': 'Link choferes regenerado',
  'driver_link.pin_changed': 'Clave de chofer cambiada',
  'blocked_slot.created': 'Horario bloqueado',
  'blocked_slot.deleted': 'Bloqueo liberado',
  'catalog.item_created': 'Item creado',
  'catalog.item_updated': 'Item editado',
  'catalog.item_deleted': 'Item eliminado',
  'user.created': 'Usuario creado',
  'user.updated': 'Usuario actualizado',
  'user.deactivated': 'Usuario desactivado',
  'user.password_reset': 'Contraseña reseteada',
  'user.role_changed': 'Perfil de usuario cambiado',
}

const ENTITY_LABELS: Record<string, string> = {
  booking: 'Reservas',
  prospect: 'Leads',
  company: 'Empresas',
  worker: 'Trabajadores',
  service_request: 'Solicitudes',
  invoice: 'Facturas',
  coupon: 'Cupones',
  marketing: 'Marketing',
  profile: 'Perfiles',
  auth: 'Sesiones',
}

function actionLabel(action: string) {
  return ACTION_LABELS[action] || action
}

function fmtDateTime(iso: string) {
  const d = new Date(iso)
  const date = new Intl.DateTimeFormat('es-CL', {
    timeZone: 'America/Santiago',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d)
  const time = new Intl.DateTimeFormat('es-CL', {
    timeZone: 'America/Santiago',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d)
  return { date, time }
}

function renderValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'object') return JSON.stringify(value, null, 2)
  return String(value)
}

export default function ActivityLog() {
  const [entries, setEntries] = useState<ActivityEntry[]>([])
  const [actors, setActors] = useState<string[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const [actor, setActor] = useState('all')
  const [entity, setEntity] = useState('all')
  // El mismo control de fecha de todo el panel.
  const [period, setPeriod] = useState<Period>(periodOf('all'))
  const range = resolvePeriod(period)
  const from = range.from || ''
  const to = range.to || ''
  const [q, setQ] = useState('')

  const fetchEntries = useCallback(
    async (nextOffset = 0) => {
      try {
        setLoading(true)
        const params = new URLSearchParams({
          limit: String(PAGE_SIZE),
          offset: String(nextOffset),
        })
        if (actor !== 'all') params.set('actor', actor)
        if (entity !== 'all') params.set('entity', entity)
        if (from) params.set('from', from)
        if (to) params.set('to', to)
        if (q.trim()) params.set('q', q.trim())

        const res = await fetch(`/api/admin/activity?${params.toString()}`)
        if (!res.ok) throw new Error('Error al cargar')
        const data = await res.json()

        setEntries(data.entries || [])
        setTotal(data.total || 0)
        setActors(data.actors || [])
        setOffset(nextOffset)
      } catch (error) {
        console.error('Error cargando la actividad:', error)
        toast.error('No se pudo cargar la actividad')
      } finally {
        setLoading(false)
      }
    },
    [actor, entity, from, to, q]
  )

  useEffect(() => {
    fetchEntries(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actor, entity, from, to])

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const escapeCsv = (v: unknown) => {
    const s = v == null ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }

  const handleExportCSV = () => {
    const columns: { header: string; value: (e: ActivityEntry) => unknown }[] = [
      { header: 'Fecha', value: (e) => fmtDateTime(e.created_at).date },
      { header: 'Hora', value: (e) => fmtDateTime(e.created_at).time },
      { header: 'Usuario', value: (e) => e.actor_username },
      { header: 'Acción', value: (e) => actionLabel(e.action) },
      { header: 'Tipo', value: (e) => e.entity_type || '' },
      { header: 'Entidad', value: (e) => e.entity_label || '' },
      { header: 'Detalle', value: (e) => e.summary },
      { header: 'Resultado', value: (e) => e.result },
      { header: 'IP', value: (e) => e.ip || '' },
    ]
    const header = columns.map((c) => escapeCsv(c.header)).join(',')
    const rows = entries.map((e) => columns.map((c) => escapeCsv(c.value(e))).join(','))
    const csv = '﻿' + [header, ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `actividad_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const page = Math.floor(offset / PAGE_SIZE) + 1
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Actividad</h2>
          <p className="text-gray-600">
            Registro de lo que hace cada usuario en el panel · se conserva 12 meses
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <PeriodFilter value={period} onChange={setPeriod} presets={['all', 'day', 'week', 'month', 'custom']} />
          <Button
            onClick={handleExportCSV}
            variant="outline"
            size="sm"
            disabled={entries.length === 0}
          >
            <Download className="w-4 h-4 mr-2" />
            Exportar CSV
          </Button>
        </div>
      </div>

      <Card className="p-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Usuario</label>
            <Select
              value={actor}
              onChange={(e) => setActor(e.target.value)}
              options={[
                { value: 'all', label: 'Todos' },
                ...actors.map((a) => ({ value: a, label: a })),
              ]}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Tipo</label>
            <Select
              value={entity}
              onChange={(e) => setEntity(e.target.value)}
              options={[
                { value: 'all', label: 'Todo' },
                { value: 'booking', label: 'Reservas' },
                { value: 'prospect', label: 'Leads' },
                { value: 'auth', label: 'Sesiones' },
                { value: 'pricing', label: 'Precios' },
                { value: 'fleet', label: 'Flota' },
                { value: 'schedule', label: 'Agenda' },
                { value: 'catalog', label: 'Catálogo' },
                { value: 'user', label: 'Usuarios' },
              ]}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Buscar</label>
            <div className="flex gap-2">
              <Input
                type="text"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') fetchEntries(0)
                }}
                placeholder="Cliente, detalle..."
              />
              <Button onClick={() => fetchEntries(0)} variant="outline" size="sm">
                <Filter className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden">
        {loading ? (
          <div className="py-12 text-center text-gray-600">Cargando actividad…</div>
        ) : entries.length === 0 ? (
          <div className="text-center py-12">
            <History className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-600">No hay actividad registrada con esos filtros</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 w-8" />
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Fecha y hora
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Usuario
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Acción
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Detalle
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {entries.map((e) => {
                  const { date, time } = fmtDateTime(e.created_at)
                  const isOpen = expanded.has(e.id)
                  const hasDetail = Boolean(e.changes)
                  return (
                    <Fragment key={e.id}>
                      <tr className="hover:bg-gray-50">
                        <td className="px-4 py-3 align-top">
                          {hasDetail && (
                            <button
                              onClick={() => toggleExpanded(e.id)}
                              className="text-gray-400 hover:text-gray-700"
                              aria-label="Ver detalle"
                            >
                              {isOpen ? (
                                <ChevronDown className="w-4 h-4" />
                              ) : (
                                <ChevronRight className="w-4 h-4" />
                              )}
                            </button>
                          )}
                        </td>
                        <td className="px-4 py-3 align-top whitespace-nowrap">
                          <div className="text-sm font-medium text-gray-900">{date}</div>
                          <div className="text-xs text-gray-500">{time} hrs</div>
                        </td>
                        <td className="px-4 py-3 align-top whitespace-nowrap">
                          <span className="text-sm text-gray-900">{e.actor_username}</span>
                        </td>
                        <td className="px-4 py-3 align-top whitespace-nowrap">
                          <span
                            className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium border ${
                              e.result === 'denied'
                                ? 'bg-red-50 text-red-700 border-red-200'
                                : e.action.startsWith('booking.deleted') ||
                                  e.action.startsWith('prospect.deleted')
                                ? 'bg-amber-50 text-amber-700 border-amber-200'
                                : 'bg-gray-100 text-gray-700 border-gray-200'
                            }`}
                          >
                            {actionLabel(e.action)}
                          </span>
                        </td>
                        <td className="px-4 py-3 align-top">
                          <div className="text-sm text-gray-900">{e.summary}</div>
                          {e.entity_label && (
                            <div className="text-xs text-gray-500">{e.entity_label}</div>
                          )}
                        </td>
                      </tr>
                      {isOpen && e.changes && (
                        <tr className="bg-gray-50">
                          <td />
                          <td colSpan={4} className="px-4 py-3">
                            <div className="space-y-2">
                              {Object.entries(e.changes).map(([field, change]) => (
                                <div key={field} className="text-xs">
                                  <span className="font-semibold text-gray-700">{field}:</span>{' '}
                                  <span className="text-red-700 line-through">
                                    {renderValue(change.from)}
                                  </span>{' '}
                                  <span className="text-gray-400">→</span>{' '}
                                  <span className="text-green-700">
                                    {renderValue(change.to)}
                                  </span>
                                </div>
                              ))}
                              {e.ip && (
                                <div className="text-[11px] text-gray-400">
                                  IP {e.ip}
                                  {e.request_path ? ` · ${e.request_path}` : ''}
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-600">
            Página {page} de {totalPages} · {total} registros
          </p>
          <div className="flex gap-2">
            <Button
              onClick={() => fetchEntries(Math.max(0, offset - PAGE_SIZE))}
              variant="outline"
              size="sm"
              disabled={offset === 0 || loading}
            >
              Anterior
            </Button>
            <Button
              onClick={() => fetchEntries(offset + PAGE_SIZE)}
              variant="outline"
              size="sm"
              disabled={offset + PAGE_SIZE >= total || loading}
            >
              Siguiente
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
