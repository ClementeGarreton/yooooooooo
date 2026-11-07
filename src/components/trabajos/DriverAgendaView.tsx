import type { ReactNode } from 'react'
import WorkerTopBar from '@/components/trabajos/WorkerTopBar'
import { DRIVER_WINDOW_DAYS, type DriverJob } from '@/lib/driverJobs'
import DriverJobNotes from '@/components/trabajos/DriverJobNotes'
import WorkerJobUploads from '@/components/trabajos/WorkerJobUploads'
import WorkOrderButton from '@/components/trabajos/WorkOrderButton'
import WorkerJobDelivery from '@/components/trabajos/WorkerJobDelivery'
import type { WorkerDelivery } from '@/lib/companyClosingTypes'
import WorkerJobClock from '@/components/trabajos/WorkerJobClock'
import type { OpenWork, WorkLog } from '@/lib/workLogTypes'
import type { DriverNote } from '@/lib/driverNotesTypes'
import WorkerJobModifications from '@/components/trabajos/WorkerJobModifications'
import type { StoredDocument } from '@/lib/documents'
import type { WorkerModification } from '@/lib/bookingModificationTypes'
import { formatStopAddress } from '@/lib/stops'
import { formatParkingDistance } from '@/lib/utils'
import { UNASSIGNED_COLOR, type VehicleColor } from '@/lib/vehicleColors'
import type { VehicleView } from '@/lib/vehicleAssignment'

// Agenda de trabajos. La usan las DOS entradas a `/trabajos`: el link por camión (token +
// PIN del camión) y el trabajador con su sesión personal (RUT + PIN). Es la misma
// pantalla; lo único que cambia es qué trabajos llegan y si se pueden subir archivos.

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']

function dateLabel(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00`)
  return `${DIAS[d.getDay()]} ${d.getDate()} de ${MESES[d.getMonth()]}`
}

function mapsUrl(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
}

function floorLine(floor: number | null, elevator: boolean | null, parking: number | null): string | null {
  const parts: string[] = []
  if (floor !== null && floor !== undefined) parts.push(`Piso ${floor}`)
  if (elevator !== null && elevator !== undefined) parts.push(elevator ? 'con ascensor' : 'sin ascensor')
  const parkingLabel = formatParkingDistance(parking ?? undefined)
  if (parkingLabel) parts.push(`acarreo: ${parkingLabel}`)
  return parts.length ? parts.join(' · ') : null
}

function AddressBlock({
  label,
  address,
  floor,
  elevator,
  parking,
}: {
  label: string
  address: string
  floor?: number | null
  elevator?: boolean | null
  parking?: number | null
}) {
  if (!address) return null
  const meta = floorLine(floor ?? null, elevator ?? null, parking ?? null)
  return (
    <div className="mt-2">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{label}</div>
      <a
        href={mapsUrl(address)}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm font-medium text-blue-700 underline underline-offset-2"
      >
        {address}
      </a>
      {meta && <div className="text-xs text-gray-500">{meta}</div>}
    </div>
  )
}

function JobCard({
  job,
  color,
  token,
  notes,
  authorLabel,
  team,
  workerDocuments,
  workerModifications,
  clock,
  delivery,
}: {
  job: DriverJob
  color: VehicleColor
  /** Token del link por camión. Sin token = trabajador con sesión personal. */
  token?: string
  notes: DriverNote[]
  /** Firma de quien mira (link o trabajador): sus notas se pueden editar. */
  authorLabel?: string
  /** Quiénes van a este trabajo (cuadrilla + camión habitual). */
  team?: { id: string; name: string; phone: string | null }[]
  /** Solo en la vista del trabajador: lo que él ya subió a este trabajo. */
  workerDocuments?: StoredDocument[]
  /** Solo en la vista del trabajador: las diferencias que él registró en este trabajo. */
  workerModifications?: WorkerModification[]
  /** Solo en la vista del trabajador: su marca de inicio/fin y el trabajo que tiene abierto. */
  clock?: { log: WorkLog | null; open: OpenWork | null }
  /** Solo en la vista del trabajador: entrega de un trabajo de empresa que se cierra por pallets o kilos. */
  delivery?: WorkerDelivery
}) {
  const isDomicilio = job.booking_type === 'domicilio'
  return (
    <div
      className="rounded-xl border border-l-4 border-gray-200 bg-white p-4 shadow-sm"
      style={{ borderLeftColor: color.hex }}
    >
      <div className="flex items-center justify-between">
        <span className="text-base font-bold text-gray-900">
          {job.scheduled_time ? job.scheduled_time.slice(0, 5) : 'Sin hora'} hrs
        </span>
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
            isDomicilio
              ? 'bg-purple-100 text-purple-700'
              : 'bg-blue-100 text-blue-700'
          }`}
        >
          {isDomicilio ? 'Visita a domicilio' : 'Mudanza'}
        </span>
      </div>
      {job.fixed_time && (
        <p className="mt-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm font-bold text-red-800">
          Horario fijo: hay que llegar a las {job.scheduled_time ? job.scheduled_time.slice(0, 5) : 'la hora acordada'}. No se puede atrasar.
        </p>
      )}

      <div className="mt-1 text-sm font-medium text-gray-900">{job.client_name}</div>
      {job.client_phone && (
        <a href={`tel:${job.client_phone}`} className="text-sm text-blue-700 underline underline-offset-2">
          {job.client_phone}
        </a>
      )}

      {isDomicilio && job.visit_address ? (
        <AddressBlock label="Dirección" address={job.visit_address} />
      ) : (
        <>
          <AddressBlock
            label="Origen"
            address={job.origin_address}
            floor={job.origin_floor}
            elevator={job.origin_has_elevator}
            parking={job.origin_parking_distance}
          />
          {job.stops.length > 0 && (
            <div className="mt-2">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                {job.stops.length === 1 ? 'Parada en el camino' : 'Paradas en el camino'}
              </div>
              <ol className="mt-1 space-y-1.5">
                {job.stops.map((parada, i) => (
                  <li key={i} className="border-l-2 border-amber-300 pl-2">
                    <a
                      href={mapsUrl(formatStopAddress(parada))}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm font-medium text-blue-700 underline underline-offset-2"
                    >
                      {i + 1}. {formatStopAddress(parada)}
                    </a>
                    {parada.note && (
                      <div className="text-xs text-amber-800">{parada.note}</div>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          )}
          <AddressBlock
            label="Destino"
            address={job.destination_address}
            floor={job.destination_floor}
            elevator={job.destination_has_elevator}
            parking={job.destination_parking_distance}
          />
        </>
      )}

      {job.items.length > 0 && (
        <div className="mt-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Items</div>
          <ul className="mt-1 flex flex-wrap gap-1.5">
            {job.items.map((it, i) => (
              <li key={i} className="rounded-md bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
                {it.quantity}× {it.name}
              </li>
            ))}
          </ul>
        </div>
      )}

      {job.notes && (
        <div className="mt-3 whitespace-pre-line rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <span className="font-semibold">Notas: </span>
          {job.notes}
        </div>
      )}

      {team && team.length > 0 && (
        <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700">
          <span className="font-semibold">Equipo de este trabajo: </span>
          {team.map((m, i) => (
            <span key={m.id}>
              {i > 0 ? ', ' : ''}
              {m.phone ? (
                <a href={`tel:${m.phone}`} className="font-medium text-blue-700 underline underline-offset-2">
                  {m.name}
                </a>
              ) : (
                <span className="font-medium">{m.name}</span>
              )}
            </span>
          ))}
        </div>
      )}

      {clock && <WorkerJobClock bookingId={job.id} log={clock.log} open={clock.open} />}

      {/* Lo que el chofer escribe DESPUÉS del trabajo. Va aparte de la nota de arriba,
          que es la que dejó el admin antes y el chofer no puede tocar. */}
      <DriverJobNotes token={token} bookingId={job.id} initialNotes={notes} authorLabel={authorLabel} />

      {workerModifications && (
        <WorkerJobModifications
          bookingId={job.id}
          initial={workerModifications}
          declaredItems={job.items.reduce((sum, it) => sum + it.quantity, 0)}
        />
      )}

      <WorkOrderButton bookingId={job.id} token={token} />
      {delivery && <WorkerJobDelivery bookingId={job.id} initial={delivery} />}

      {workerDocuments && <WorkerJobUploads bookingId={job.id} documents={workerDocuments} />}

      {/* Cambiar el camión se hace en el panel, no acá.
          Esta pantalla la abre un chofer con un PIN de 4 dígitos compartido: meterle una
          acción que reescribe la agenda sería darle a ese PIN un permiso que no le
          corresponde. El link lleva a la reserva ya buscada; a quien no tenga sesión de
          administrador, el panel le pide login y no ve nada. */}
      {job.quote_id && (
        <a
          href={`/admin?tab=bookings&q=${encodeURIComponent(job.quote_id)}`}
          className="mt-2 inline-block text-[11px] text-gray-400 underline underline-offset-2"
        >
          Abrir en el panel (reasignar camión · solo administradores)
        </a>
      )}
    </div>
  )
}

interface VehicleGroup {
  key: string
  label: string
  color: VehicleColor
  items: DriverJob[]
}

/**
 * Día → camión. Los camiones van en el orden de la flota y "Sin asignar" siempre al
 * final: si un trabajo todavía no tiene camión, tiene que saltar a la vista, no
 * esconderse entre medio.
 */
function groupByDateAndVehicle(
  jobs: DriverJob[],
  vehicles: VehicleView[]
): Array<{ date: string; vehicleGroups: VehicleGroup[] }> {
  const byId = new Map(vehicles.map((v) => [v.id, v]))
  const order = new Map(vehicles.map((v, i) => [v.id, i]))
  const dates: string[] = []
  const byDate = new Map<string, Map<string, VehicleGroup>>()

  for (const job of jobs) {
    if (!byDate.has(job.scheduled_date)) {
      byDate.set(job.scheduled_date, new Map())
      dates.push(job.scheduled_date)
    }
    const vehicle = job.vehicle_id !== null ? byId.get(job.vehicle_id) : undefined
    const key = vehicle ? String(vehicle.id) : 'sin-asignar'
    const groupsOfDay = byDate.get(job.scheduled_date)!

    if (!groupsOfDay.has(key)) {
      groupsOfDay.set(key, {
        key,
        label: vehicle
          ? vehicle.driver
            ? `${vehicle.name} · ${vehicle.driver}`
            : vehicle.name
          : 'Sin asignar',
        color: vehicle ? vehicle.color : UNASSIGNED_COLOR,
        items: [],
      })
    }
    groupsOfDay.get(key)!.items.push(job)
  }

  return dates.map((date) => ({
    date,
    vehicleGroups: [...byDate.get(date)!.values()].sort((a, b) => {
      const ai = a.key === 'sin-asignar' ? Number.MAX_SAFE_INTEGER : order.get(Number(a.key)) ?? 0
      const bi = b.key === 'sin-asignar' ? Number.MAX_SAFE_INTEGER : order.get(Number(b.key)) ?? 0
      return ai - bi
    }),
  }))
}

export default function DriverAgendaView({
  label,
  emptyText,
  jobs,
  vehicles,
  notesByBooking,
  teamByBooking,
  token,
  documentsByBooking,
  modificationsByBooking,
  deliveriesByBooking,
  workLogs,
  headerAction,
  title = 'Trabajos por hacer',
  subtitle,
  tabs,
  beforeJobs,
  offline = true,
}: {
  /** A quién pertenece la vista: "Camión 2 · Pedro" o el nombre del trabajador. */
  label: string
  emptyText: string
  jobs: DriverJob[]
  vehicles: VehicleView[]
  notesByBooking: Map<string, DriverNote[]>
  /** Quiénes van a cada trabajo, para que el equipo se coordine. */
  teamByBooking?: Map<string, { id: string; name: string; phone: string | null }[]>
  /** Token del link por camión. Sin token = trabajador con sesión personal. */
  token?: string
  /** Solo para el trabajador: sus marcas de inicio/fin y el trabajo que tiene abierto. */
  workLogs?: { logs: Map<string, WorkLog>; open: OpenWork | null }
  /** Solo para el trabajador: lo que él subió, por reserva. Habilita la subida. */
  documentsByBooking?: Map<string, StoredDocument[]>
  /** Solo para el trabajador: las diferencias que registró, por reserva. Habilita el registro. */
  modificationsByBooking?: Map<string, WorkerModification[]>
  /** Solo para el trabajador: entregas de empresa por completar, por reserva. */
  deliveriesByBooking?: Map<string, WorkerDelivery>
  headerAction?: ReactNode
  title?: string
  subtitle?: string
  /** Vistas del trabajador con sesión personal. */
  tabs?: { href: string; label: string; active: boolean }[]
  /** Va entre el encabezado y los trabajos (las tareas del trabajador). */
  beforeJobs?: ReactNode
  /** Modo sin conexión. false en la vista de administrador («Ver como»). */
  offline?: boolean
}) {
  // Agrupar por fecha y, dentro de cada día, por camión. El orden de los camiones es el
  // de la flota (no el de aparición) para que la lista se lea igual todos los días.
  const groups = groupByDateAndVehicle(jobs, vehicles)

  // Leyenda: los camiones activos más, si hace falta, el gris de "Sin asignar". Sirve
  // para que cada chofer reconozca su color de un vistazo aunque hoy no tenga trabajos.
  const legend: Array<{ label: string; color: VehicleColor }> = vehicles
    .filter((v) => v.status === 'active')
    .map((v) => ({ label: v.driver ? `${v.name} · ${v.driver}` : v.name, color: v.color }))
  if (jobs.some((j) => !j.vehicle_id)) {
    legend.push({ label: 'Sin asignar', color: UNASSIGNED_COLOR })
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <WorkerTopBar label={label} action={headerAction} tabs={tabs} offline={offline} />

      <div className="mx-auto max-w-lg px-4 py-6">
        <header className="mb-5">
          <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
          <p className="text-sm text-slate-500">{subtitle || `Próximos ${DRIVER_WINDOW_DAYS} días`}</p>

          {legend.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {legend.map((entry) => (
                <span
                  key={entry.color.key + entry.label}
                  className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold"
                  style={{ backgroundColor: entry.color.soft, color: entry.color.ink }}
                >
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: entry.color.hex }}
                    aria-hidden
                  />
                  {entry.label}
                </span>
              ))}
            </div>
          )}
        </header>

        {beforeJobs}

        {jobs.length === 0 ? (
          <div className="rounded-xl border border-gray-200 bg-white p-8 text-center">
            <p className="text-sm text-gray-600">
              {emptyText}
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {groups.map((group) => (
              <section key={group.date}>
                <h2 className="mb-2 text-sm font-semibold capitalize text-gray-500">
                  {dateLabel(group.date)}
                </h2>
                <div className="space-y-4">
                  {group.vehicleGroups.map((vg) => (
                    <div key={vg.key}>
                      <div
                        className="flex items-center justify-between rounded-lg px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-white"
                        style={{ backgroundColor: vg.color.hex }}
                      >
                        <span>{vg.label}</span>
                        <span className="font-semibold opacity-90">
                          {vg.items.length} {vg.items.length === 1 ? 'trabajo' : 'trabajos'}
                        </span>
                      </div>
                      <div className="mt-2 space-y-3">
                        {vg.items.map((job) => (
                          <JobCard
                            key={job.id}
                            job={job}
                            color={vg.color}
                            token={token}
                            notes={notesByBooking.get(job.id) || []}
                            authorLabel={label}
                            team={teamByBooking?.get(job.id)}
                            workerDocuments={
                              documentsByBooking ? documentsByBooking.get(job.id) || [] : undefined
                            }
                            workerModifications={
                              modificationsByBooking ? modificationsByBooking.get(job.id) || [] : undefined
                            }
                            delivery={deliveriesByBooking?.get(job.id)}
                            clock={
                              workLogs
                                ? {
                                    log: workLogs.logs.get(job.id) || null,
                                    open: workLogs.open && workLogs.open.bookingId !== job.id ? workLogs.open : null,
                                  }
                                : undefined
                            }
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}

        <footer className="mt-8 text-center text-[11px] text-gray-400">
          Actualiza la página para ver los últimos trabajos.
        </footer>
      </div>
    </div>
  )
}
