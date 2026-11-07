import { listCustomerRequests } from '@/lib/serviceRequests'
import { SERVICE_TYPE_LABEL, type RequestStep, type ServiceRequestView } from '@/lib/serviceRequestTypes'
import { requireCustomerId } from '../../session'
import PageTitle from '../../PageTitle'
import { formatDate, formatTime } from '../../format'

export const dynamic = 'force-dynamic'

const STATUS_BADGE = {
  pendiente: { label: 'Esperando respuesta', className: 'bg-amber-50 text-amber-700' },
  aprobada: { label: 'Aprobada', className: 'bg-green-50 text-green-700' },
  rechazada: { label: 'No se pudo tomar', className: 'bg-red-50 text-red-700' },
} as const

function when(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleString('es-CL', {
    timeZone: 'America/Santiago',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function Steps({ steps }: { steps: RequestStep[] }) {
  return (
    <ol className="mt-4 space-y-2">
      {steps.map((s) => (
        <li key={s.key} className="flex items-start gap-3 text-sm">
          <span
            className={`mt-1 h-3 w-3 shrink-0 rounded-full ${
              !s.done ? 'border-2 border-slate-300' : s.key === 'rechazada' || s.key === 'cancelada' ? 'bg-red-500' : 'bg-brand-green'
            }`}
            aria-hidden
          />
          <div>
            <p className={s.done ? 'font-semibold text-slate-900' : 'text-slate-400'}>{s.label}</p>
            {s.done && (s.at || s.by) && (
              <p className="text-xs text-slate-500">{[when(s.at), s.by].filter(Boolean).join(' · ')}</p>
            )}
            {s.detail && <p className="mt-0.5 text-sm text-slate-600">{s.detail}</p>}
          </div>
        </li>
      ))}
    </ol>
  )
}

function RequestCard({ request }: { request: ServiceRequestView }) {
  const badge = STATUS_BADGE[request.status]
  return (
    <article className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-bold text-brand-blue-dark">
          {request.code} · {SERVICE_TYPE_LABEL[request.serviceType]}
        </span>
        <span className={`rounded-full px-3 py-1 text-xs font-bold ${badge.className}`}>{badge.label}</span>
      </div>
      <p className="mt-2 font-semibold text-slate-900">
        {request.origin} → {request.destination}
      </p>
      <p className="mt-1 text-sm text-slate-500">
        {formatDate(request.requestedDate)}
        {formatTime(request.requestedTime)}
        {request.company ? ` · ${request.company.razon_social}` : ''}
        {request.volumeM3 != null ? ` · ${request.volumeM3} m³` : ''}
        {request.peopleNeeded != null ? ` · ${request.peopleNeeded} personas` : ''}
      </p>
      <p className="mt-2 whitespace-pre-line text-sm text-slate-600">{request.description}</p>

      <Steps steps={request.steps} />

      {request.booking && (
        <a
          href={`/mi-cuenta/reservas/${request.booking.id}`}
          className="mt-4 inline-block text-sm font-bold text-brand-blue-dark hover:underline"
        >
          Ver la reserva {request.booking.code || ''} →
        </a>
      )}
    </article>
  )
}

/**
 * Solicitudes (Módulo 3): lo que la persona pidió y en qué va cada una, del envío al
 * cierre. El encargado de una empresa ve también las de su empresa.
 */
export default async function SolicitudesPage({ searchParams }: { searchParams: { enviada?: string } }) {
  const customerId = await requireCustomerId()
  const { available, requests } = await listCustomerRequests(customerId)

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 lg:px-10 lg:py-12">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageTitle title="Solicitudes" subtitle="Pide una mudanza, un transporte o una carga y sigue cada paso." />
        {available && (
          <a
            href="/mi-cuenta/solicitudes/nueva"
            className="rounded-xl bg-brand-green px-5 py-3 font-bold text-white hover:opacity-90"
          >
            Nueva solicitud
          </a>
        )}
      </div>

      {searchParams.enviada === '1' && (
        <p className="mb-6 rounded-xl bg-green-50 px-4 py-3 text-sm font-semibold text-green-800">
          Solicitud enviada. Te confirmamos precio y fecha a la brevedad.
        </p>
      )}

      {!available ? (
        <p className="text-sm text-slate-500">Las solicitudes todavía no están habilitadas. Escríbenos por WhatsApp.</p>
      ) : requests.length === 0 ? (
        <p className="text-sm text-slate-500">Todavía no has enviado solicitudes.</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {requests.map((r) => (
            <RequestCard key={r.id} request={r} />
          ))}
        </div>
      )}
    </main>
  )
}
