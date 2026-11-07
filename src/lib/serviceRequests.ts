/**
 * Solicitudes de servicio (etapa 2, paso 5 / Módulo 3).
 *
 * El flujo, tal como lo aprobó Tomás en la propuesta:
 *   1. El cliente o la empresa envía la solicitud desde su panel.
 *   2. El equipo la cotiza y la aprueba: en el admin, «Aprobar y agendar» abre la «Nueva
 *      reserva» de siempre con los datos de la solicitud, se le pone el precio y al
 *      guardarla la solicitud queda aprobada y enlazada a esa reserva. O se rechaza con un
 *      motivo.
 *   3. Se asigna el equipo (camión y cuadrilla) en la reserva, como cualquier otra.
 *   4. El cliente sigue cada paso hasta el cierre (reserva completada).
 *
 * No hay un motor de precios nuevo para transporte y carga: el precio lo pone quien aprueba.
 * Los pasos posteriores a la aprobación no se guardan dos veces: se leen de la reserva y
 * del registro de Actividad, que ya tiene la fecha y el usuario de cada cambio.
 */

import { approvalsUrl, notifyTeam } from '@/lib/teamNotices'
import { supabaseAdmin } from '@/lib/supabase'
import { chileTodayString } from '@/lib/vehicleAssignment'
import { getCustomerCompany } from '@/lib/customerAccount'
import {
  PRIORITY_HOURS,
  SERVICE_TYPES,
  SERVICE_TYPE_LABEL,
  isPriorityRequest,
  type RequestStep,
  type ServiceRequestStatus,
  type ServiceRequestView,
  type ServiceType,
} from '@/lib/serviceRequestTypes'

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Tope de solicitudes pendientes por persona: nadie necesita más, y frena el abuso. */
export const MAX_PENDING_PER_CUSTOMER = 10

// `*` y no una lista: `volume_m3` y `people_needed` son de add_operacion_terreno.sql, y una
// columna nombrada que todavía no existe rompería toda la pantalla de solicitudes.
const REQUEST_FIELDS = '*'

interface RequestRow {
  id: string
  code: string
  customer_id: string
  company_id: string | null
  service_type: ServiceType
  origin_address: string
  destination_address: string
  requested_date: string
  requested_time: string | null
  contact: string | null
  description: string
  status: ServiceRequestStatus
  resolved_by: string | null
  resolved_at: string | null
  rejection_reason: string | null
  booking_id: string | null
  created_at: string
  volume_m3?: number | string | null
  people_needed?: number | null
  // add_servicio_pallets.sql
  pallets?: number | null
  repalletize?: boolean | null
  is_priority?: boolean | null
  priority_accepted_at?: string | null
  // add_pendientes_oct.sql
  fixed_time?: boolean | null
}

export class ServiceRequestError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message)
    this.name = 'ServiceRequestError'
  }
}

/** 42P01 / PGRST205 = falta correr add_service_requests.sql. */
export function isMissingRequestsTable(error: { code?: string } | null | undefined): boolean {
  return error?.code === '42P01' || error?.code === 'PGRST205'
}

const clean = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : ''

/** Crea una solicitud del cliente de la sesión. `forCompany` = es para su empresa. */
export async function createServiceRequest(customerId: string, body: any): Promise<{ id: string; code: string }> {
  const serviceType = SERVICE_TYPES.find((t) => t.value === body?.serviceType)?.value
  if (!serviceType) throw new ServiceRequestError('Elige qué necesitas: mudanza, transporte, carga o pallets.')
  const isPallets = serviceType === 'pallets'

  const origin = clean(body?.origin, 300)
  const destination = clean(body?.destination, 300)
  if (origin.length < 3 || destination.length < 3) throw new ServiceRequestError('Escribe el origen y el destino.')

  const date = typeof body?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : ''
  if (!date || Number.isNaN(Date.parse(`${date}T12:00:00Z`))) throw new ServiceRequestError('Elige la fecha del servicio.')
  if (date < chileTodayString()) throw new ServiceRequestError('La fecha ya pasó. Elige una de hoy en adelante.')
  const time = typeof body?.time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(body.time) ? body.time : null

  // En «Pallets» solo se piden la cantidad y notas, ninguna obligatoria (Tomás, 20-10-2026).
  const description =
    typeof body?.description === 'string' ? body.description.trim().slice(0, 2000) : ''
  if (!isPallets && description.length < 3) throw new ServiceRequestError('Cuéntanos qué hay que trasladar.')

  // Menos de 24 h de anticipación: tarifa prioritaria, que el cliente acepta al enviar.
  const isPriority = isPriorityRequest(date, time)
  if (isPriority && body?.acceptPriority !== true) {
    throw new ServiceRequestError(
      `Para un servicio con menos de ${PRIORITY_HOURS} horas de anticipación tienes que aceptar la tarifa prioritaria y los términos y condiciones.`
    )
  }

  const company = body?.forCompany === true ? await getCustomerCompany(customerId) : null

  // m³ y personal: obligatorios cuando el servicio es de una empresa (Tomás, 09-10-2026);
  // en una solicitud personal son opcionales.
  const given = (v: unknown) => v !== undefined && v !== null && String(v).trim() !== ''
  const volume = !isPallets && given(body?.volumeM3) ? Math.round(Number(String(body.volumeM3).replace(',', '.')) * 100) / 100 : null
  const people = !isPallets && given(body?.peopleNeeded) ? Number(body.peopleNeeded) : null
  const pallets = isPallets && given(body?.pallets) ? Number(body.pallets) : null
  if (pallets !== null && !(Number.isInteger(pallets) && pallets >= 1 && pallets <= 10_000)) {
    throw new ServiceRequestError('Revisa la cantidad de pallets: un número entero desde 1.')
  }
  const repalletize = isPallets && body?.repalletize === true
  if (company && !isPallets && (volume === null || people === null)) {
    throw new ServiceRequestError('Indica los m³ y cuántas personas necesitas: en los servicios de empresa son obligatorios.')
  }
  if (volume !== null && !(volume > 0 && volume <= 500)) throw new ServiceRequestError('Revisa los m³: tiene que ser un número entre 0 y 500.')
  if (people !== null && !(Number.isInteger(people) && people >= 1 && people <= 20)) {
    throw new ServiceRequestError('Revisa la cantidad de personas: entre 1 y 20.')
  }

  const { count, error: countError } = await supabaseAdmin
    .from('service_requests')
    .select('id', { count: 'exact', head: true })
    .eq('customer_id', customerId)
    .eq('status', 'pendiente')
  if (countError) {
    if (isMissingRequestsTable(countError)) {
      throw new ServiceRequestError('Las solicitudes todavía no están habilitadas. Escríbenos por WhatsApp.', 503)
    }
    throw countError
  }
  if ((count || 0) >= MAX_PENDING_PER_CUSTOMER) {
    throw new ServiceRequestError('Ya tienes varias solicitudes esperando respuesta. Te contactamos pronto.', 429)
  }

  const row = {
    customer_id: customerId,
    company_id: company?.id || null,
    service_type: serviceType,
    origin_address: origin,
    destination_address: destination,
    requested_date: date,
    requested_time: time,
    contact: clean(body?.contact, 200) || null,
    description: description || (isPallets ? 'Pallets' : description),
  }
  const insert = (values: Record<string, unknown>) => supabaseAdmin.from('service_requests').insert(values).select('id, code').single()
  const extra = { ...(volume !== null ? { volume_m3: volume } : {}), ...(people !== null ? { people_needed: people } : {}) }
  const palletsExtra = {
    ...(pallets !== null ? { pallets } : {}),
    ...(repalletize ? { repalletize: true } : {}),
    ...(isPriority ? { is_priority: true, priority_accepted_at: new Date().toISOString() } : {}),
  }
  // Hora fija de retiro o entrega: va aparte por si falta add_pendientes_oct.sql.
  const fixedTime = body?.fixedTime === true && Boolean(time)
  let { data, error } = await insert({ ...row, ...extra, ...palletsExtra, ...(fixedTime ? { fixed_time: true } : {}) })
  if (error && fixedTime && /fixed_time/.test(`${error.message} ${error.details || ''}`)) {
    ;({ data, error } = await insert({ ...row, ...extra, ...palletsExtra, description: `${row.description}\n[Horario fijo: ${time}]`.slice(0, 2000) }))
  }
  if (error && /pallets|repalletize|is_priority|priority_accepted_at|service_type_check/.test(`${error.message} ${error.details || ''}`)) {
    // Falta add_servicio_pallets.sql.
    if (isPallets) throw new ServiceRequestError('El servicio de pallets todavía no está habilitado. Escríbenos por WhatsApp.', 503)
    // La prioridad aceptada queda en la descripción para no perderla.
    ;({ data, error } = await insert({
      ...row,
      ...extra,
      description: isPriority ? `${description}\n[Prioritaria: menos de ${PRIORITY_HOURS} h, aceptó la tarifa prioritaria]`.slice(0, 2000) : description,
    }))
  }
  if (error && Object.keys(extra).length > 0 && /volume_m3|people_needed/.test(`${error.message} ${error.details || ''}`)) {
    // Falta add_operacion_terreno.sql: los dos datos van en la descripción para no perderlos.
    const tail = [volume !== null ? `${volume} m³` : null, people !== null ? `${people} personas` : null].filter(Boolean).join(' · ')
    ;({ data, error } = await insert({ ...row, description: `${description}\n[${tail}]`.slice(0, 2000) }))
  }
  if (error || !data) throw error || new Error('Solicitud sin respuesta')

  // Aviso al equipo: la solicitud ya quedó en «Por aprobar» aunque el correo no salga.
  const { data: customer } = await supabaseAdmin.from('customers').select('name, code, email, phone').eq('id', customerId).maybeSingle()
  await notifyTeam({
    label: 'solicitud-nueva',
    key: `service-request/${data.id}`,
    subject: `Solicitud nueva ${data.code || ''}: ${SERVICE_TYPE_LABEL[serviceType]} para el ${date}`.replace(/\s+/g, ' '),
    lines: [
      `${customer?.name || 'Un cliente'}${company ? ` (${company.razon_social})` : ''} pidio un servicio y espera respuesta.`,
      '',
      `Tipo: ${SERVICE_TYPE_LABEL[serviceType]}`,
      `Fecha: ${date}${time ? ` a las ${time}` : ''}`,
      `Origen: ${origin}`,
      `Destino: ${destination}`,
      ...(isPriority ? [`PRIORITARIA: menos de ${PRIORITY_HOURS} h de anticipacion. El cliente acepto la tarifa prioritaria.`] : []),
      ...(fixedTime ? [`HORARIO FIJO: hay que estar a las ${time}.`] : []),
      ...(isPallets
        ? [`Pallets: ${pallets ?? 'sin indicar'}${repalletize ? ' - con repaletizado' : ''}`, ...(description ? [`Notas: ${description}`] : [])]
        : [`Que hay que trasladar: ${description}`]),
      ...(volume !== null || people !== null
        ? [`Volumen y personal: ${[volume !== null ? `${volume} m3` : null, people !== null ? `${people} personas` : null].filter(Boolean).join(' - ')}`]
        : []),
      '',
      `Cliente: ${[customer?.code, customer?.email, customer?.phone].filter(Boolean).join(' - ')}`,
      '',
      `Se aprueba o rechaza en el panel, pestaña Por aprobar: ${approvalsUrl()}`,
    ],
  })
  return data
}

function buildSteps(
  row: RequestRow,
  customerName: string | null,
  booking: any | null,
  logs: { action: string; actor_username: string; created_at: string; changes: any }[],
  hasCrew: boolean
): RequestStep[] {
  const steps: RequestStep[] = [
    { key: 'enviada', label: 'Solicitud enviada', done: true, at: row.created_at, by: customerName },
  ]

  if (row.status === 'rechazada') {
    steps.push({
      key: 'rechazada',
      label: 'No pudimos tomarla',
      done: true,
      at: row.resolved_at,
      by: row.resolved_by,
      detail: row.rejection_reason,
    })
    return steps
  }

  const approved = row.status === 'aprobada'
  steps.push({
    key: 'aprobada',
    label: 'Cotizada y aprobada',
    done: approved,
    at: approved ? row.resolved_at : null,
    by: approved ? row.resolved_by : null,
  })

  if (booking?.status === 'cancelled') {
    const log = logs.find((l) => l.action === 'booking.status_changed' && l.changes?.status?.to === 'cancelled')
    steps.push({ key: 'cancelada', label: 'Reserva cancelada', done: true, at: log?.created_at || null, by: log?.actor_username || null })
    return steps
  }

  // Asignación: camión puesto (a mano o por el reparto) o cuadrilla marcada. La fecha sale
  // del último cambio registrado; si el camión se asignó al crear la reserva, de la aprobación.
  const assigned = Boolean(booking && (booking.vehicle_id != null || hasCrew))
  const assignLog = logs.find((l) => l.action === 'booking.vehicle_assigned' || l.action === 'booking.workers_changed')
  steps.push({
    key: 'asignada',
    label: 'Equipo asignado',
    done: assigned,
    at: assigned ? assignLog?.created_at || row.resolved_at : null,
    by: assigned ? assignLog?.actor_username || row.resolved_by : null,
  })

  const completed = booking?.status === 'completed'
  const doneLog = logs.find((l) => l.action === 'booking.status_changed' && l.changes?.status?.to === 'completed')
  steps.push({
    key: 'realizada',
    label: 'Servicio realizado',
    done: completed,
    at: completed ? booking.service_completed_at || doneLog?.created_at || null : null,
    by: completed ? doneLog?.actor_username || null : null,
  })
  return steps
}

/** Arma las vistas (con cliente, empresa, reserva y seguimiento) de un lote de solicitudes. */
async function toViews(rows: RequestRow[]): Promise<ServiceRequestView[]> {
  if (rows.length === 0) return []
  const customerIds = Array.from(new Set(rows.map((r) => r.customer_id)))
  const companyIds = Array.from(new Set(rows.map((r) => r.company_id).filter((id): id is string => !!id)))
  const bookingIds = rows.map((r) => r.booking_id).filter((id): id is string => !!id)

  const none = Promise.resolve({ data: [] as any[] })
  const [customers, companies, bookings, logs, crew] = await Promise.all([
    supabaseAdmin.from('customers').select('id, code, name, email, phone').in('id', customerIds),
    companyIds.length ? supabaseAdmin.from('companies').select('id, code, razon_social, rut').in('id', companyIds) : none,
    bookingIds.length
      ? supabaseAdmin.from('bookings').select('id, code, quote_id, status, vehicle_id, service_completed_at').in('id', bookingIds)
      : none,
    bookingIds.length
      ? supabaseAdmin
          .from('admin_activity_log')
          .select('entity_id, action, actor_username, created_at, changes')
          .eq('entity_type', 'booking')
          .in('entity_id', bookingIds)
          .in('action', ['booking.vehicle_assigned', 'booking.workers_changed', 'booking.status_changed'])
          .order('created_at', { ascending: false })
          .limit(1000)
      : none,
    bookingIds.length ? supabaseAdmin.from('booking_workers').select('booking_id').in('booking_id', bookingIds) : none,
  ])

  const customerById = new Map((customers.data || []).map((c: any) => [c.id, c]))
  const companyById = new Map((companies.data || []).map((c: any) => [c.id, c]))
  const bookingById = new Map((bookings.data || []).map((b: any) => [b.id, b]))
  const crewBookings = new Set((crew.data || []).map((c: any) => c.booking_id))

  return rows.map((row) => {
    const customer = customerById.get(row.customer_id) || {
      id: row.customer_id,
      code: '',
      name: null,
      email: '',
      phone: null,
    }
    const booking = row.booking_id ? bookingById.get(row.booking_id) || null : null
    const bookingLogs = (logs.data || []).filter((l: any) => l.entity_id === row.booking_id)
    return {
      id: row.id,
      code: row.code,
      serviceType: row.service_type,
      origin: row.origin_address,
      destination: row.destination_address,
      requestedDate: row.requested_date,
      requestedTime: row.requested_time,
      contact: row.contact,
      description: row.description,
      volumeM3: row.volume_m3 != null ? Number(row.volume_m3) : null,
      peopleNeeded: row.people_needed ?? null,
      pallets: row.pallets ?? null,
      repalletize: row.repalletize === true,
      isPriority: row.is_priority === true,
      priorityAcceptedAt: row.priority_accepted_at ?? null,
      fixedTime: row.fixed_time === true,
      status: row.status,
      rejectionReason: row.rejection_reason,
      createdAt: row.created_at,
      customer,
      company: row.company_id ? companyById.get(row.company_id) || null : null,
      booking: booking ? { id: booking.id, code: booking.code, quoteId: booking.quote_id, status: booking.status } : null,
      steps: buildSteps(row, customer.name || customer.email || null, booking, bookingLogs, crewBookings.has(row.booking_id || '')),
    }
  })
}

/**
 * Solicitudes que ve una persona en su panel: las suyas y, si es ENCARGADO de una empresa,
 * las de toda la empresa. Sin la migración devuelve `available: false`.
 */
export async function listCustomerRequests(customerId: string): Promise<{ available: boolean; requests: ServiceRequestView[] }> {
  const company = await getCustomerCompany(customerId)
  let query = supabaseAdmin.from('service_requests').select(REQUEST_FIELDS).order('created_at', { ascending: false }).limit(100)
  query =
    company?.role === 'encargado'
      ? query.or(`customer_id.eq.${customerId},company_id.eq.${company.id}`)
      : query.eq('customer_id', customerId)
  const { data, error } = await query
  if (error) {
    if (!isMissingRequestsTable(error)) console.error('[serviceRequests] Error listando:', error)
    return { available: !isMissingRequestsTable(error), requests: [] }
  }
  const views = await toViews((data || []) as unknown as RequestRow[])
  // En el panel del cliente no se muestran los usuarios internos: quién aprobó o asignó es
  // «el equipo». El nombre de quien envió la solicitud sí.
  return {
    available: true,
    requests: views.map((v) => ({
      ...v,
      steps: v.steps.map((s) => (s.key === 'enviada' ? s : { ...s, by: null })),
    })),
  }
}

/** Bandeja del admin: las pendientes primero y después las resueltas más recientes. */
export async function listAdminRequests(): Promise<{ available: boolean; requests: ServiceRequestView[]; pending: number }> {
  const [pending, resolved] = await Promise.all([
    supabaseAdmin.from('service_requests').select(REQUEST_FIELDS).eq('status', 'pendiente').order('created_at', { ascending: true }).limit(200),
    supabaseAdmin.from('service_requests').select(REQUEST_FIELDS).neq('status', 'pendiente').order('resolved_at', { ascending: false }).limit(50),
  ])
  const error = pending.error || resolved.error
  if (error) {
    if (!isMissingRequestsTable(error)) console.error('[serviceRequests] Error en la bandeja:', error)
    return { available: !isMissingRequestsTable(error), requests: [], pending: 0 }
  }
  const rows = [...(pending.data || []), ...(resolved.data || [])] as unknown as RequestRow[]
  return { available: true, requests: await toViews(rows), pending: (pending.data || []).length }
}

/**
 * Enlaza una solicitud pendiente con la reserva que se acaba de crear al aprobarla, y le
 * copia a la reserva la empresa de la solicitud (lo que se le va a facturar). Lo llama la
 * creación de reservas del admin. La condición `status = pendiente` va también en el
 * UPDATE: si dos personas aprueban a la vez, gana una sola.
 */
export async function approveRequestWithBooking(
  requestId: unknown,
  bookingId: string,
  actorUsername: string | null
): Promise<{ code: string; companyId: string | null } | null> {
  if (typeof requestId !== 'string' || !UUID_RE.test(requestId)) return null
  const { data, error } = await supabaseAdmin
    .from('service_requests')
    .update({
      status: 'aprobada',
      booking_id: bookingId,
      resolved_by: actorUsername || 'sistema',
      resolved_at: new Date().toISOString(),
    })
    .eq('id', requestId)
    .eq('status', 'pendiente')
    .select('*')
    .maybeSingle()
  if (error || !data) {
    if (error) console.error('[serviceRequests] Error aprobando:', error)
    return null
  }
  if (data.company_id) {
    const { error: companyError } = await supabaseAdmin
      .from('bookings')
      .update({ company_id: data.company_id })
      .eq('id', bookingId)
    if (companyError) console.error('[serviceRequests] Error copiando la empresa a la reserva:', companyError)
  }
  // Los m³ y el personal que pidió pasan a la reserva, salvo que quien aprobó ya los haya
  // puesto a mano al armarla (por eso la condición `is null`).
  if (data.volume_m3 != null) {
    await supabaseAdmin.from('bookings').update({ volume_m3: data.volume_m3 }).eq('id', bookingId).is('volume_m3', null)
  }
  if (data.people_needed != null) {
    await supabaseAdmin.from('bookings').update({ people_needed: data.people_needed }).eq('id', bookingId).is('people_needed', null)
  }
  // Servicio, pallets, repaletizado y prioridad (add_servicio_pallets.sql). La prioridad va
  // como «urgente», que es lo que cobra el cierre de una empresa con recargo de urgencia.
  const serviceUpdate: Record<string, unknown> = { service_type: data.service_type }
  if (data.service_type === 'pallets') {
    serviceUpdate.delivery_unit = 'pallets'
    if (data.repalletize) serviceUpdate.repalletize = true
  }
  if (data.is_priority) serviceUpdate.is_urgent = true
  if (data.fixed_time) {
    const { error: fixedError } = await supabaseAdmin.from('bookings').update({ fixed_time: true }).eq('id', bookingId)
    if (fixedError) console.error('[serviceRequests] Error copiando la hora fija:', fixedError)
  }
  const { error: serviceError } = await supabaseAdmin.from('bookings').update(serviceUpdate).eq('id', bookingId)
  if (serviceError) console.error('[serviceRequests] Error copiando el servicio a la reserva:', serviceError)
  if (data.pallets != null) {
    await supabaseAdmin.from('bookings').update({ pallets: data.pallets }).eq('id', bookingId).is('pallets', null)
  }
  return { code: data.code, companyId: data.company_id }
}

/** Rechaza una solicitud pendiente con un motivo que el cliente va a leer. */
export async function rejectRequest(requestId: string, reason: string, actorUsername: string | null) {
  if (!UUID_RE.test(requestId)) throw new ServiceRequestError('Solicitud no encontrada', 404)
  const motivo = reason.trim().slice(0, 500)
  if (motivo.length < 3) throw new ServiceRequestError('Escribe el motivo: el cliente lo va a leer en su panel.')
  const { data, error } = await supabaseAdmin
    .from('service_requests')
    .update({
      status: 'rechazada',
      rejection_reason: motivo,
      resolved_by: actorUsername || 'sistema',
      resolved_at: new Date().toISOString(),
    })
    .eq('id', requestId)
    .eq('status', 'pendiente')
    .select('id, code')
    .maybeSingle()
  if (error) throw error
  if (!data) throw new ServiceRequestError('Esa solicitud ya fue resuelta.', 409)
  return data
}
