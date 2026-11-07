import { cookies } from 'next/headers'
import { getUpcomingDriverJobs, DRIVER_WINDOW_DAYS } from '@/lib/driverJobs'
import { resolveDriverAccess } from '@/lib/driverAccess'
import { driverSessionCookieName, verifyDriverSessionToken } from '@/lib/driverSession'
import DriverPinGate from '@/components/trabajos/DriverPinGate'
import DriverAgendaView from '@/components/trabajos/DriverAgendaView'
import { getDriverNotesFor } from '@/lib/driverNotes'
import { getJobTeams } from '@/lib/workerJobs'

export const dynamic = 'force-dynamic'

export default async function DriverJobsPage({ params }: { params: { token: string } }) {
  // El token dice a QUÉ da acceso: a un camión (link nuevo) o a todo (link general
  // heredado). De ahí sale también el PIN que hay que exigir y el scope de la sesión.
  const access = await resolveDriverAccess(params.token)

  if (!access) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="text-center">
          <h1 className="text-lg font-semibold text-gray-900">Enlace no válido</h1>
          <p className="mt-1 text-sm text-gray-600">
            Este link de trabajos no es válido o fue reemplazado. Pídele el link actualizado al
            administrador.
          </p>
        </div>
      </div>
    )
  }

  // Segunda capa: además del link con token, hay que ingresar el PIN. La sesión vive
  // en una cookie firmada (12h), así que no se pide en cada carga durante la jornada.
  // Se valida contra el scope de ESTE link: la sesión de un camión no abre la de otro.
  const pinOk = await verifyDriverSessionToken(
    cookies().get(driverSessionCookieName(access.scope))?.value,
    access.scope
  )
  if (!pinOk) {
    return <DriverPinGate token={params.token} label={access.label} />
  }

  const { jobs, vehicles } = await getUpcomingDriverJobs(access.vehicleId)

  // Todas las notas de los trabajos visibles en una sola consulta, para no hacer una por
  // tarjeta. Sin la migración aplicada devuelve vacío y la agenda funciona igual.
  const notesByBooking = await getDriverNotesFor(jobs.map((j) => j.id))
  const teamByBooking = await getJobTeams(jobs)

  return (
    <DriverAgendaView
      label={access.label}
      emptyText={
        access.kind === 'vehicle'
          ? `No hay trabajos asignados a este camión en los próximos ${DRIVER_WINDOW_DAYS} días.`
          : `No hay trabajos programados en los próximos ${DRIVER_WINDOW_DAYS} días.`
      }
      jobs={jobs}
      vehicles={vehicles}
      notesByBooking={notesByBooking}
      teamByBooking={teamByBooking}
      token={params.token}
    />
  )
}
