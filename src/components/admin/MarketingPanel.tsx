'use client'

import { useCallback, useEffect, useState } from 'react'
import Card from '@/components/ui/Card'
import toast from 'react-hot-toast'
import MarketingConfiguration from './MarketingConfiguration'
import ReferralCredits from './ReferralCredits'
import RecommendersPanel from './RecommendersPanel'
import PeriodFilter from './PeriodFilter'
import { periodOf, resolvePeriod, type Period } from '@/lib/period'

/**
 * Marketing: lo que el sistema le manda a los clientes y lo que se les ofrece. Dos vistas:
 * «Correos» (el registro de correos automáticos del mes, solo lectura) y «Cupones y
 * referidos» (crear cupones y configurar el programa).
 */

interface EmailRow {
  id: string
  email_type: string
  recipient: string
  status: 'pending' | 'sent' | 'failed' | 'skipped'
  skip_reason: string | null
  error: string | null
  sent_at: string | null
  created_at: string
}

interface EmailsData {
  period: string
  total: number
  sentInMonth: number
  truncated: boolean
  byStatus: Record<string, number>
  byType: Record<string, { sent: number; total: number }>
  emails: EmailRow[]
}

// Nombres de los tipos de correo que existen en el código. Uno que no esté acá se muestra
// con su clave tal cual.
const TYPE_LABEL: Record<string, string> = {
  '01_quote': 'Cotización',
  '02_reminder': 'Recordatorio de cotización',
  '03_social_proof': 'Prueba social',
  '04_last_call': 'Último aviso de cotización',
  '05_booking_confirmed': 'Reserva confirmada',
  '06_payment_due_2h': 'Pago pendiente (2 h)',
  '06_payment_due_24h': 'Pago pendiente (24 h)',
  '06b_recovery': 'Recuperación de pago',
  '07_payment_rejected': 'Pago rechazado',
  '08_service_d3': 'Faltan 3 días para el servicio',
  '09_service_d1': 'Mañana es el servicio',
  '10_review_request': 'Pedido de reseña',
  '11_reactivation': 'Reactivación',
  cuenta_link_acceso: 'Link de acceso a la cuenta',
  digest_interno: 'Resumen interno',
}

const STATUS = {
  sent: { label: 'Enviado', className: 'bg-green-50 text-green-700' },
  pending: { label: 'Pendiente', className: 'bg-amber-50 text-amber-700' },
  failed: { label: 'Falló', className: 'bg-red-50 text-red-700' },
  skipped: { label: 'No se envió', className: 'bg-gray-100 text-gray-600' },
} as const

const typeLabel = (t: string) => TYPE_LABEL[t] || t
const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString('es-CL', { timeZone: 'America/Santiago', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    : '—'

function EmailsView() {
  // El mismo control de fecha de todo el panel. Abre en el mes en curso.
  const [period, setPeriod] = useState<Period>(periodOf('month'))
  const resolved = resolvePeriod(period)
  const month = resolvePeriod(periodOf('month'))
  const from = resolved.from && resolved.to ? resolved.from : (month.from as string)
  const to = resolved.from && resolved.to ? resolved.to : (month.to as string)
  const [data, setData] = useState<EmailsData | null>(null)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')

  const load = useCallback(async () => {
    setData(null)
    try {
      const res = await fetch(`/api/admin/emails?desde=${from}&hasta=${to}`)
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || 'No se pudieron cargar los correos')
      setData(body)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudieron cargar los correos')
    }
  }, [from, to])

  useEffect(() => {
    load()
  }, [load])

  const q = search.trim().toLowerCase()
  const shown = (data?.emails || []).filter(
    (e) => (status === 'all' || e.status === status) && (!q || e.recipient.includes(q) || typeLabel(e.email_type).toLowerCase().includes(q))
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-gray-600">Correos automáticos del sistema. Es un registro: desde acá no se envía nada.</p>
        <PeriodFilter value={period} onChange={setPeriod} presets={['day', 'week', 'month', 'custom']} />
      </div>

      {!data ? (
        <p className="text-sm text-gray-500">Cargando…</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Card className="p-4">
              <p className="text-sm text-gray-500">Enviados en el período</p>
              <p className="text-2xl font-bold text-gray-900">{data.sentInMonth}</p>
            </Card>
            {(['pending', 'skipped', 'failed'] as const).map((s) => (
              <Card key={s} className="p-4">
                <p className="text-sm text-gray-500">{STATUS[s].label}</p>
                <p className="text-2xl font-bold text-gray-900">{data.byStatus[s] || 0}</p>
              </Card>
            ))}
          </div>

          <Card className="p-4">
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">Por tipo de correo</p>
            {Object.keys(data.byType).length === 0 ? (
              <p className="text-sm text-gray-500">Sin correos en este mes.</p>
            ) : (
              <ul className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                {Object.entries(data.byType)
                  .sort((a, b) => b[1].total - a[1].total)
                  .map(([type, n]) => (
                    <li key={type} className="flex justify-between gap-3">
                      <span className="text-gray-800">{typeLabel(type)}</span>
                      <span className="text-gray-500">
                        {n.sent} enviados de {n.total}
                      </span>
                    </li>
                  ))}
              </ul>
            )}
          </Card>

          <Card className="overflow-hidden p-0">
            <div className="flex flex-wrap gap-2 border-b border-gray-100 p-3">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por correo o tipo..."
                className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
              />
              <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm">
                <option value="all">Todos los estados</option>
                {Object.entries(STATUS).map(([value, s]) => (
                  <option key={value} value={value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  <tr>
                    <th className="px-4 py-2">Fecha</th>
                    <th className="px-4 py-2">Correo</th>
                    <th className="px-4 py-2">Para</th>
                    <th className="px-4 py-2">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {shown.map((e) => (
                    <tr key={e.id}>
                      <td className="whitespace-nowrap px-4 py-2 text-gray-600">{when(e.sent_at || e.created_at)}</td>
                      <td className="px-4 py-2 text-gray-900">{typeLabel(e.email_type)}</td>
                      <td className="px-4 py-2 text-gray-600">{e.recipient}</td>
                      <td className="px-4 py-2">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS[e.status]?.className || ''}`}>
                          {STATUS[e.status]?.label || e.status}
                        </span>
                        {(e.skip_reason || e.error) && <span className="ml-2 text-xs text-gray-500">{e.skip_reason || e.error}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="border-t border-gray-100 px-4 py-2 text-xs text-gray-500">
              {shown.length} de {data.total} registros del mes
              {data.total > data.emails.length ? ` (se listan los ${data.emails.length} más recientes)` : ''}
              {data.truncated ? ' · el mes tiene más de 2.000 registros: los conteos por tipo son de los más recientes' : ''}
            </p>
          </Card>
        </>
      )}
    </div>
  )
}

export default function MarketingPanel({ allowed }: { /** ¿El perfil ve esta pestaña? Sin esto, las ve todas. */ allowed?: (section: string) => boolean }) {
  const views = (
    [
      ['emails', 'Correos'],
      ['coupons', 'Cupones y referidos'],
    ] as const
  ).filter(([id]) => !allowed || allowed(id))
  const [chosen, setView] = useState<'emails' | 'coupons'>('emails')
  const view = views.some(([id]) => id === chosen) ? chosen : views[0]?.[0]
  if (!view) return <p className="text-sm text-gray-600">Tu perfil no tiene ninguna pestaña de Marketing activa.</p>
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Marketing</h2>
          <p className="text-gray-600">Correos automáticos, cupones y referidos.</p>
        </div>
        <div className="flex gap-1 rounded-xl bg-gray-100 p-1 text-sm">
          {views.map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setView(id)}
              aria-pressed={view === id}
              className={`rounded-lg px-3 py-1.5 font-semibold ${view === id ? 'bg-white text-primary-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {view === 'emails' ? (
        <EmailsView />
      ) : (
        <>
          <MarketingConfiguration />
          <RecommendersPanel />
          <ReferralCredits />
        </>
      )}
    </div>
  )
}
