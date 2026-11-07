import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase'
import { resolveDriverAccess } from '@/lib/driverAccess'
import { driverSessionCookieName, verifyDriverSessionToken } from '@/lib/driverSession'
import { getUpcomingDriverJobs } from '@/lib/driverJobs'
import { getDriverNotesFor } from '@/lib/driverNotes'
import { getSessionWorker } from '@/lib/workerSession'
import { getWorkerHistory, workerCanActOn } from '@/lib/workerJobs'
import { bookingToAdminQuoteData, mergeBookingQuoteDetails, type AdminBookingQuoteSource } from '@/lib/adminBookingQuoteData'

export const dynamic = 'force-dynamic'

/**
 * Datos de la orden de trabajo de un trabajo, para que el chofer la descargue en PDF desde su
 * panel o desde el link de su camión (Tomás, 21-10-2026). El PDF se arma en el navegador con
 * el mismo generador del admin, en su versión SIN precios; acá además se borran los montos,
 * para que no viajen al teléfono del chofer.
 *
 * `?bookingId=` y, desde el link del camión, `&token=`. Mismos candados que las notas: un
 * trabajador solo pide trabajos suyos; un link, solo trabajos de su agenda y con el PIN puesto.
 */
export async function GET(request: NextRequest) {
  const bookingId = request.nextUrl.searchParams.get('bookingId') || ''
  const token = request.nextUrl.searchParams.get('token')

  if (token) {
    const access = await resolveDriverAccess(token)
    if (!access) return NextResponse.json({ error: 'Enlace no válido' }, { status: 403 })
    const sessionOk = await verifyDriverSessionToken(cookies().get(driverSessionCookieName(access.scope))?.value, access.scope)
    if (!sessionOk) return NextResponse.json({ error: 'Vuelve a ingresar el PIN' }, { status: 401 })
    const { jobs } = await getUpcomingDriverJobs(access.vehicleId)
    if (!jobs.some((j) => j.id === bookingId)) return NextResponse.json({ error: 'Ese trabajo no está en tu agenda' }, { status: 403 })
  } else {
    const worker = await getSessionWorker()
    if (!worker) return NextResponse.json({ error: 'Tu sesión venció. Vuelve a entrar.' }, { status: 401 })
    // Solo lectura: además de lo que puede tocar, vale todo su historial (hasta un año).
    if (!(await workerCanActOn(worker, bookingId))) {
      const history = await getWorkerHistory(worker, { to: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date()) })
      if (!history.jobs.some((j) => j.id === bookingId)) return NextResponse.json({ error: 'Ese trabajo no es tuyo o ya pasó hace mucho' }, { status: 403 })
    }
  }

  const { data: booking } = await supabaseAdmin.from('bookings').select('*').eq('id', bookingId).maybeSingle()
  if (!booking) return NextResponse.json({ error: 'Trabajo no encontrado' }, { status: 404 })
  const [{ data: prospects }, notes] = await Promise.all([
    booking.quote_id
      ? supabaseAdmin.from('quote_prospects').select('*').or(`converted_booking_id.eq.${booking.id},quote_id.eq.${booking.quote_id}`).limit(5)
      : supabaseAdmin.from('quote_prospects').select('*').eq('converted_booking_id', booking.id).limit(5),
    getDriverNotesFor([booking.id]),
  ])
  const [merged] = mergeBookingQuoteDetails([booking as AdminBookingQuoteSource], (prospects || []) as any[])
  const data = bookingToAdminQuoteData({
    ...merged,
    driver_notes: (notes.get(booking.id) || []).map((n) => ({ note: n.note, vehicle_label: n.vehicle_label, created_at: n.created_at })),
  })
  // Sin montos: la orden de trabajo no los muestra y tampoco tienen que viajar. De los
  // servicios adicionales solo pasa lo que la orden usa: sí/no, cuadrilla y observaciones
  // (el recargo por exceso de volumen viene en pesos y se reduce a «sí/no»).
  const svc = (data.additionalServices || {}) as Record<string, unknown>
  const yes = (k: string) => svc[k] === true
  const count = (k: string) => (typeof svc[k] === 'number' && Number.isFinite(svc[k] as number) ? (svc[k] as number) : undefined)
  const safe = {
    ...data,
    totalPrice: null,
    additionalServices: data.additionalServices
      ? {
          packing: yes('packing'),
          unpacking: yes('unpacking'),
          assembly: yes('assembly'),
          disassembly: yes('disassembly'),
          fridgeDisassembly: yes('fridgeDisassembly'),
          priority: yes('priority'),
          stairsCarry: yes('stairsCarry'),
          overCapacitySurcharge: Number(svc.overCapacitySurcharge) > 0 ? 1 : 0,
          extraHelpers: count('extraHelpers'),
          requiredCrew: count('requiredCrew'),
          totalCrew: count('totalCrew'),
          observations: typeof svc.observations === 'string' ? svc.observations : undefined,
        }
      : data.additionalServices,
    items: (data.items || []).map((item: any) => ({ ...item, packaging: item.packaging ? { type: item.packaging.type } : undefined })),
  }
  return NextResponse.json({ data: safe })
}
