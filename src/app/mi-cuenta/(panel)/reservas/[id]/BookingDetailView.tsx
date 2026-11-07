import type { AccountBookingDetail } from '@/lib/customerAccount'
import BookingStatus from '../../../BookingStatus'
import { clp, formatLongDate, formatVolume } from '../../../format'
import RescheduleBox from './RescheduleBox'
import PayBalanceButton from './PayBalanceButton'
import type { RescheduleBlock } from '@/lib/customerReschedule'
import type { StoredDocument } from '@/lib/documents'
import DocumentList from '@/components/documents/DocumentList'
import DocumentUploader from '@/components/documents/DocumentUploader'
import type { BookingHistory } from '@/lib/customerBookingHistory'
import type { CustomerAssignment } from '@/lib/customerAssignment'

const fmtStamp = (iso: string) =>
  new Date(iso).toLocaleString('es-CL', {
    timeZone: 'America/Santiago',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
const fmtDay = (d: string) => d.slice(0, 10).split('-').reverse().join('-')

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-slate-100 py-3 first:border-t-0 first:pt-0">
      <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p>
      <div className="mt-1 text-slate-900">{children}</div>
    </div>
  )
}

/**
 * Detalle de una reserva (Módulo 1, paso 3): fecha, hora, direcciones, paradas y volumen,
 * más el estado de pago y el cambio de fecha (paso 4). Separado de la página para poder
 * mirarlo con datos de ejemplo. Pagar el saldo y escribir por WhatsApp son los pasos 5 y 6.
 */
export default function BookingDetailView({
  booking,
  rescheduleReason,
  documents = [],
  companyView,
  noun = 'mudanza',
  history = null,
  assignment = null,
}: {
  booking: AccountBookingDetail
  rescheduleReason: RescheduleBlock | null
  documents?: StoredDocument[]
  /**
   * Reserva de otra persona de la empresa. `canEdit` = quien mira es el encargado y puede
   * pagar o cambiar la fecha; si no, es un miembro y la ve en solo lectura.
   */
  companyView?: { clientName: string | null; canEdit?: boolean }
  /** «mudanza» o «trabajo» (persona de una empresa), ver serviceWords. */
  noun?: string
  /** Lo que se pidió, notas, entrega e hitos hasta el cierre. */
  history?: BookingHistory | null
  /** Camión, patente y chofer del trabajo. null = aún sin asignar: no se muestra nada. */
  assignment?: CustomerAssignment | null
}) {
  const time = booking.scheduledTime ? booking.scheduledTime.slice(0, 5) : null
  const duration =
    booking.durationHours !== null
      ? `${booking.durationHours.toLocaleString('es-CL', { maximumFractionDigits: 1 })} ${
          booking.durationHours === 1 ? 'hora estimada' : 'horas estimadas'
        }`
      : null

  const load = [
    booking.volumeM3 !== null ? formatVolume(booking.volumeM3) : null,
    booking.itemCount !== null
      ? `${booking.itemCount} ${booking.itemCount === 1 ? 'artículo' : 'artículos'}`
      : null,
  ].filter(Boolean)

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 lg:px-10 lg:py-12">
      <a
        href={companyView ? '/mi-cuenta/empresa' : '/mi-cuenta/reservas'}
        className="text-sm font-semibold text-brand-blue-dark hover:underline"
      >
        {companyView ? '← Empresa' : '← Mis reservas'}
      </a>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold text-slate-900">Reserva {booking.code || ''}</h1>
        <BookingStatus status={booking.status} />
      </div>

      <div className="mt-6 grid gap-6 md:grid-cols-3">
        <section className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm md:col-span-2">
          <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500">
            Detalle del servicio
          </h2>
          <p className="mt-2 text-xl font-bold text-slate-900">
            {formatLongDate(booking.scheduledDate)}
          </p>
          {(time || duration) && (
            <p className="mt-1 text-sm text-slate-500">
              {[time, duration].filter(Boolean).join(' · ')}
            </p>
          )}
          {companyView && (
            <p className="mt-4 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
              Reserva de la empresa, hecha por {companyView.clientName || 'otra persona'}.{' '}
              {companyView.canEdit
                ? 'Como encargado de la cuenta puedes pagarla o cambiarle la fecha.'
                : 'La ves como miembro de la empresa, en solo lectura: pagar o cambiar la fecha lo hace el encargado de la cuenta.'}
            </p>
          )}
          {companyView && !companyView.canEdit ? null : (
            <div className="mt-4">
              <RescheduleBox bookingId={booking.id} reason={rescheduleReason} noun={noun} />
            </div>
          )}

          <div className="mt-5">
            <Row label="Origen">{booking.origin || 'Por definir'}</Row>
            {booking.stops.map((stop, i) => (
              <Row key={i} label={booking.stops.length === 1 ? 'Parada' : `Parada ${i + 1}`}>
                {stop.address}
                {stop.note && <p className="mt-0.5 text-sm text-slate-500">{stop.note}</p>}
              </Row>
            ))}
            <Row label="Destino">{booking.destination || 'Por definir'}</Row>
            {load.length > 0 && <Row label="Volumen">{load.join(' · ')}</Row>}
            {assignment && (
              <Row label="Camión asignado">
                <p className="font-semibold">{assignment.vehicleName}</p>
                {(assignment.plate || assignment.driver) && (
                  <p className="mt-0.5 text-sm text-slate-500">
                    {[
                      assignment.plate ? `Patente ${assignment.plate}` : null,
                      assignment.driver ? `Chofer: ${assignment.driver}` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                )}
                <p className="mt-0.5 text-xs text-slate-400">
                  Estos datos se confirman el día del servicio.
                </p>
              </Row>
            )}
          </div>
        </section>

        <section className="h-fit rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
          <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500">Pago</h2>
          {booking.price > 0 ? (
            <>
              <dl className="mt-3 space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-slate-500">Total del servicio</dt>
                  <dd className="font-bold text-slate-900">{clp(booking.price)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500">Pagado</dt>
                  <dd className="font-bold text-slate-900">{clp(booking.paid)}</dd>
                </div>
                <div className="flex justify-between border-t border-slate-100 pt-2">
                  <dt className="font-semibold text-slate-700">Saldo pendiente</dt>
                  <dd
                    className={`text-lg font-bold ${booking.pending > 0 ? 'text-amber-600' : 'text-slate-900'}`}
                  >
                    {clp(booking.pending)}
                  </dd>
                </div>
              </dl>
              {booking.canPayBalance && (
                <PayBalanceButton bookingId={booking.id} pending={booking.pending} />
              )}
            </>
          ) : (
            <p className="mt-3 text-sm text-slate-500">
              Este servicio no tiene un monto registrado. Si tienes dudas sobre el pago, escríbenos.
            </p>
          )}
        </section>
      </div>

      {history && <HistorySection history={history} />}

      <section className="mt-6 rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
        <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500">
          Fotos y documentos
        </h2>
        <div className="mt-4 grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <DocumentList
              documents={documents}
              hrefFor={(doc, download) => `/api/cuenta/documentos/${doc.id}${download ? '?descargar=1' : ''}`}
              empty="Todavía no hay archivos de este servicio."
            />
          </div>
          <DocumentUploader
            ticketsUrl="/api/cuenta/documentos/subir"
            confirmUrl="/api/cuenta/documentos/confirmar"
            extra={{ bookingId: booking.id }}
            title="Agregar a esta reserva"
          />
        </div>
      </section>
    </main>
  )
}

/** Historial completo: lo que se pidió, notas, entrega, diferencias y cada hito con su fecha. */
function HistorySection({ history }: { history: BookingHistory }) {
  const r = history.request
  const requested: [string, string][] = r
    ? ([
        ['Servicio', `${r.serviceLabel}${r.isPriority ? ' · prioritario (menos de 24 h, tarifa prioritaria aceptada)' : ''}`],
        ['Fecha pedida', `${fmtDay(r.requestedDate)}${r.requestedTime ? ` · ${r.requestedTime.slice(0, 5)}` : ''}`],
        ['Origen', r.origin],
        ['Destino', r.destination],
        r.contact ? ['Contacto en origen', r.contact] : null,
        r.volumeM3 !== null ? ['Volumen', `${r.volumeM3.toLocaleString('es-CL')} m³`] : null,
        r.peopleNeeded !== null ? ['Personas', String(r.peopleNeeded)] : null,
        r.pallets !== null ? ['Pallets', String(r.pallets)] : null,
        r.repalletize ? ['Repaletizar', 'Sí'] : null,
        r.description ? ['Detalle', r.description] : null,
      ].filter(Boolean) as [string, string][])
    : []
  const d = history.delivery
  const delivery: [string, string][] = d
    ? ([
        d.pallets !== null ? ['Pallets entregados', String(d.pallets)] : null,
        d.kg !== null ? ['Kilos entregados', d.kg.toLocaleString('es-CL')] : null,
        d.odNumber ? ['N° de OD', d.odNumber] : null,
        d.guideNumber ? ['N° de guía de despacho o factura', d.guideNumber] : null,
        d.repalletize ? ['Repaletizado', 'Sí'] : null,
      ].filter(Boolean) as [string, string][])
    : []

  return (
    <section className="mt-6 rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
      <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500">Historial del servicio</h2>
      <div className="mt-4 grid gap-6 lg:grid-cols-2">
        <div className="space-y-5">
          {r && (
            <div>
              <p className="text-sm font-bold text-slate-900">
                Lo que pediste · Solicitud {r.code} ({fmtStamp(r.createdAt)})
              </p>
              <dl className="mt-2 text-sm">
                {requested.map(([label, value]) => (
                  <div key={label} className="border-t border-slate-100 py-2 first:border-t-0">
                    <dt className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</dt>
                    <dd className="mt-0.5 whitespace-pre-line text-slate-900">{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
          {history.items.length > 0 && (
            <div>
              <p className="text-sm font-bold text-slate-900">Artículos cotizados</p>
              <ul className="mt-2 grid gap-1 text-sm text-slate-700 sm:grid-cols-2">
                {history.items.map((item, i) => (
                  <li key={i}>
                    {item.quantity} × {item.name}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {history.extras.length > 0 && (
            <div>
              <p className="text-sm font-bold text-slate-900">Servicios adicionales</p>
              <p className="mt-1 text-sm text-slate-700">{history.extras.join(' · ')}</p>
            </div>
          )}
          {history.notes && (
            <div>
              <p className="text-sm font-bold text-slate-900">Notas</p>
              <p className="mt-1 whitespace-pre-line rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-700">{history.notes}</p>
            </div>
          )}
          {delivery.length > 0 && (
            <div>
              <p className="text-sm font-bold text-slate-900">Entrega</p>
              <dl className="mt-2 text-sm">
                {delivery.map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-4 border-t border-slate-100 py-2 first:border-t-0">
                    <dt className="text-slate-500">{label}</dt>
                    <dd className="text-right font-semibold text-slate-900">{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </div>

        <div>
          <p className="text-sm font-bold text-slate-900">Paso a paso</p>
          {history.events.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">Todavía no hay movimientos registrados.</p>
          ) : (
            <ol className="mt-3 space-y-3 border-l-2 border-slate-200 pl-4">
              {history.events.map((e, i) => (
                <li key={i} className="relative">
                  <span className="absolute -left-[1.4rem] top-1.5 h-2.5 w-2.5 rounded-full bg-brand-blue-dark" aria-hidden />
                  <p className="text-sm font-semibold text-slate-900">{e.label}</p>
                  {e.detail && <p className="text-xs text-slate-600">{e.detail}</p>}
                  <p className="text-xs text-slate-500">{fmtStamp(e.at)}</p>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </section>
  )
}
