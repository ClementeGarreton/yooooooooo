import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { resolveDriverAccess } from '@/lib/driverAccess'
import { driverSessionCookieName, verifyDriverSessionToken } from '@/lib/driverSession'
import { getUpcomingDriverJobs } from '@/lib/driverJobs'
import { addDriverNote, updateDriverNote, DRIVER_NOTE_MAX_LENGTH } from '@/lib/driverNotes'
import { getSessionWorker } from '@/lib/workerSession'
import { workerCanActOn } from '@/lib/workerJobs'

export const dynamic = 'force-dynamic'

/**
 * El chofer agrega una nota sobre un trabajo, desde su link.
 *
 * TRES CANDADOS, y los tres hacen falta:
 *
 *  1. El token del link tiene que resolver a un acceso válido.
 *  2. La cookie de sesión tiene que ser la DE ESE MISMO SCOPE. Sin esto, tener el link
 *     alcanzaría para escribir sin haber puesto nunca el PIN.
 *  3. La reserva tiene que estar en LA AGENDA DE ESE CHOFER. Es el candado que importa:
 *     se comprueba contra `getUpcomingDriverJobs(access.vehicleId)`, la misma función que
 *     pinta su pantalla, así que un id de reserva de otro camión —o de una fecha fuera de
 *     la ventana de 4 días, o de una cancelada— no pasa. Sin esto, cualquiera con un link
 *     válido podría escribir en CUALQUIER reserva del sistema mandando su id.
 *
 * El rate limit está en el middleware (ver RATE_LIMIT_RULES).
 */
export async function POST(request: NextRequest) {
  try {
    const { token, bookingId, note } = await request.json()

    // Sin token de link: es un trabajador con su sesión personal (RUT + PIN). Mismos
    // candados, con su propia agenda; la nota queda firmada con su nombre y código.
    if (!token) {
      const worker = await getSessionWorker()
      if (!worker) {
        return NextResponse.json({ error: 'Tu sesión venció. Vuelve a entrar.' }, { status: 401 })
      }
      const texto = String(note || '').trim()
      if (!texto) {
        return NextResponse.json({ error: 'Escribe algo antes de guardar' }, { status: 400 })
      }
      if (texto.length > DRIVER_NOTE_MAX_LENGTH) {
        return NextResponse.json(
          { error: `La nota no puede pasar de ${DRIVER_NOTE_MAX_LENGTH} caracteres` },
          { status: 400 }
        )
      }
      const job = await workerCanActOn(worker, String(bookingId || ''))
      if (!job) {
        return NextResponse.json({ error: 'Ese trabajo no es tuyo o ya pasó hace mucho' }, { status: 403 })
      }
      const result = await addDriverNote({
        bookingId: job.id,
        note: texto,
        vehicleId: job.vehicle_id,
        vehicleLabel: `${worker.name} · ${worker.code}`,
      })
      if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
      return NextResponse.json({ success: true, note: result.note })
    }

    const access = await resolveDriverAccess(String(token || ''))
    if (!access) {
      return NextResponse.json({ error: 'Enlace no válido' }, { status: 403 })
    }

    const sessionOk = await verifyDriverSessionToken(
      cookies().get(driverSessionCookieName(access.scope))?.value,
      access.scope
    )
    if (!sessionOk) {
      return NextResponse.json({ error: 'Volvé a ingresar el PIN' }, { status: 401 })
    }

    const texto = String(note || '').trim()
    if (!texto) {
      return NextResponse.json({ error: 'Escribe algo antes de guardar' }, { status: 400 })
    }
    if (texto.length > DRIVER_NOTE_MAX_LENGTH) {
      return NextResponse.json(
        { error: `La nota no puede pasar de ${DRIVER_NOTE_MAX_LENGTH} caracteres` },
        { status: 400 }
      )
    }

    const { jobs } = await getUpcomingDriverJobs(access.vehicleId)
    const job = jobs.find((j) => j.id === String(bookingId || ''))
    if (!job) {
      return NextResponse.json(
        { error: 'Ese trabajo no está en tu agenda' },
        { status: 403 }
      )
    }

    const result = await addDriverNote({
      bookingId: job.id,
      note: texto,
      vehicleId: access.vehicleId,
      vehicleLabel: access.label,
    })

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    return NextResponse.json({ success: true, note: result.note })
  } catch (error) {
    console.error('Error guardando la nota del chofer:', error)
    return NextResponse.json({ error: 'No se pudo guardar la nota' }, { status: 500 })
  }
}

/**
 * Corregir una nota propia. Mismos tres candados que al escribirla, más uno: la nota tiene
 * que haberla escrito ese mismo link o ese mismo trabajador. Body: `{ token?, bookingId, noteId, note }`.
 */
export async function PATCH(request: NextRequest) {
  try {
    const { token, bookingId, noteId, note } = await request.json()
    if (!/^[0-9a-f-]{36}$/i.test(String(noteId || ''))) {
      return NextResponse.json({ error: 'Nota no encontrada' }, { status: 404 })
    }

    let jobId: string | null = null
    let authorLabel: string | null = null
    if (!token) {
      const worker = await getSessionWorker()
      if (!worker) return NextResponse.json({ error: 'Tu sesión venció. Vuelve a entrar.' }, { status: 401 })
      const job = await workerCanActOn(worker, String(bookingId || ''))
      jobId = job?.id || null
      authorLabel = `${worker.name} · ${worker.code}`
    } else {
      const access = await resolveDriverAccess(String(token))
      if (!access) return NextResponse.json({ error: 'Enlace no válido' }, { status: 403 })
      const sessionOk = await verifyDriverSessionToken(
        cookies().get(driverSessionCookieName(access.scope))?.value,
        access.scope
      )
      if (!sessionOk) return NextResponse.json({ error: 'Volvé a ingresar el PIN' }, { status: 401 })
      const { jobs } = await getUpcomingDriverJobs(access.vehicleId)
      jobId = jobs.find((j) => j.id === String(bookingId || ''))?.id || null
      authorLabel = access.label
    }
    if (!jobId) return NextResponse.json({ error: 'Ese trabajo no está en tu agenda' }, { status: 403 })

    const result = await updateDriverNote({ noteId: String(noteId), bookingId: jobId, note: String(note || ''), authorLabel })
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
    return NextResponse.json({ success: true, note: result.note })
  } catch (error) {
    console.error('Error editando la nota del chofer:', error)
    return NextResponse.json({ error: 'No se pudo guardar la nota' }, { status: 500 })
  }
}
