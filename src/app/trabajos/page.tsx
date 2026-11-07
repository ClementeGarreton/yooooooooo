import type { Metadata } from 'next'
import { supabaseAdmin } from '@/lib/supabase'
import { DRIVER_WINDOW_DAYS } from '@/lib/driverJobs'
import { getDriverNotesFor } from '@/lib/driverNotes'
import type { StoredDocument } from '@/lib/documents'
import { getSessionWorker } from '@/lib/workerSession'
import { WORKER_ACTION_DAYS, WORKER_HISTORY_DAYS, getJobTeams, getWorkerAgenda, getWorkerHistory } from '@/lib/workerJobs'
import { getWorkerModifications } from '@/lib/bookingModifications'
import { getWorkerWorkLogs } from '@/lib/workLogs'
import { getDeliveriesFor } from '@/lib/companyClosing'
import { tasksForWorker } from '@/lib/jobTasks'
import DriverAgendaView from '@/components/trabajos/DriverAgendaView'
import WorkerTopBar from '@/components/trabajos/WorkerTopBar'
import WorkerDocuments from '@/components/trabajos/WorkerDocuments'
import WorkerLoginGate from '@/components/trabajos/WorkerLoginGate'
import WorkerLogoutButton from '@/components/trabajos/WorkerLogoutButton'
import WorkerOwnDataForm from '@/components/trabajos/WorkerOwnDataForm'
import WorkerTasks from '@/components/trabajos/WorkerTasks'
import WorkerPayDownloads from '@/components/trabajos/WorkerPayDownloads'
import { listOwnPayClosings } from '@/lib/workerPay'
import { getWorkerOwnData } from '@/lib/workerSignup'
import AdminPreviewBanner from '@/components/AdminPreviewBanner'
import { getActivePreview } from '@/lib/adminPreviewServer'
import { WORKER_FIELDS, type Worker } from '@/lib/workers'
import { countUnreadWorkerNotifications, getWorkerNotifications, markWorkerNotificationsRead } from '@/lib/workerNotifications'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Trabajos por hacer', robots: { index: false, follow: false } }

type View = 'hacer' | 'historial' | 'documentos' | 'avisos' | 'pagos' | 'datos'

/**
 * Panel del trabajador: cada persona entra con su RUT y su PIN personal (se crean en el
 * admin, pestaña Flota). Cuatro vistas:
 *  - Por hacer: la misma agenda del link de choferes, con lo que le toca en estos días, y
 *    arriba sus tareas (las suyas y las de su camión habitual), que marca hechas.
 *  - Historial: lo que hizo en los últimos meses, con sus notas, diferencias y archivos;
 *    los trabajos recientes todavía aceptan una nota o un gasto.
 *  - Mis documentos: todo lo que subió y documentos personales sin trabajo asociado.
 *  - Avisos: trabajos que le asignaron, le quitaron, se reprogramaron o se cancelaron.
 *    Abrir la pestaña los marca como leídos (salvo en la vista de administrador).
 * Los links por camión (`/trabajos/<token>`) siguen funcionando.
 */
export default async function WorkerJobsPage({ searchParams }: { searchParams: { vista?: string; desde?: string; hasta?: string } }) {
  // Vista de administrador («Ver como»): se pinta la agenda del trabajador elegido, sin su
  // sesión. Las rutas de /api/trabajos quedan bloqueadas por el middleware mientras dure.
  const preview = await getActivePreview('worker')
  let worker: Worker | null = null
  if (preview) {
    const { data } = await supabaseAdmin.from('workers').select(WORKER_FIELDS).eq('id', preview.id).maybeSingle()
    worker = (data as Worker | null) || null
  } else {
    worker = await getSessionWorker()
  }
  if (!worker) return <WorkerLoginGate />

  const view: View =
    searchParams.vista === 'historial'
      ? 'historial'
      : searchParams.vista === 'documentos'
        ? 'documentos'
        : searchParams.vista === 'avisos'
          ? 'avisos'
          : searchParams.vista === 'pagos'
            ? 'pagos'
            : searchParams.vista === 'datos'
              ? 'datos'
              : 'hacer'
  const unread = view === 'avisos' ? 0 : await countUnreadWorkerNotifications(worker.id)
  const label = `${worker.name} · ${worker.code}`
  const tabs = [
    { href: '/trabajos', label: 'Por hacer', active: view === 'hacer' },
    { href: '/trabajos?vista=historial', label: 'Historial', active: view === 'historial' },
    { href: '/trabajos?vista=documentos', label: 'Mis documentos', active: view === 'documentos' },
    { href: '/trabajos?vista=avisos', label: unread > 0 ? `Avisos (${unread})` : 'Avisos', active: view === 'avisos' },
    { href: '/trabajos?vista=pagos', label: 'Mis pagos', active: view === 'pagos' },
    { href: '/trabajos?vista=datos', label: 'Mis datos', active: view === 'datos' },
  ]
  const banner = preview ? <AdminPreviewBanner who={`${worker.name} (${worker.code})`} /> : null
  const action = preview ? undefined : <WorkerLogoutButton />

  const ownDocuments = () =>
    supabaseAdmin
      .from('documents')
      // `*` para traer el estado del gasto si add_expense_review.sql ya está corrida.
      .select('*')
      .eq('uploaded_by_type', 'trabajador')
      .eq('uploaded_by_id', worker!.id)
      .order('created_at', { ascending: false })

  if (view === 'pagos') {
    const closings = await listOwnPayClosings(worker.id)
    return (
      <>
        {banner}
        <div className="min-h-screen bg-slate-50">
          <WorkerTopBar label={label} action={action} tabs={tabs} offline={!preview} />
          <div className="mx-auto max-w-lg px-4 py-6">
            <h1 className="text-2xl font-bold text-slate-900">Mis pagos</h1>
            <p className="text-sm text-slate-500">El detalle de cada período cerrado: tus trabajos día a día, gastos, ajustes y lo pagado.</p>
            <WorkerPayDownloads closings={closings} readOnly={Boolean(preview)} />
          </div>
        </div>
      </>
    )
  }

  if (view === 'datos') {
    const own = await getWorkerOwnData(worker.id)
    return (
      <>
        {banner}
        <div className="min-h-screen bg-slate-50">
          <WorkerTopBar label={label} action={action} tabs={tabs} offline={!preview} />
          <div className="mx-auto max-w-lg px-4 py-6">
            <h1 className="text-2xl font-bold text-slate-900">Mis datos</h1>
            <p className="mb-4 text-sm text-slate-500">Tu contacto y la cuenta donde te pagan.</p>
            {own ? <WorkerOwnDataForm initial={own} readOnly={Boolean(preview)} /> : <p className="text-sm text-slate-500">No encontramos tu ficha.</p>}
          </div>
        </div>
      </>
    )
  }

  if (view === 'avisos') {
    const notifications = await getWorkerNotifications(worker.id)
    if (!preview && notifications.some((n) => !n.read_at)) await markWorkerNotificationsRead(worker.id)
    const when = (iso: string) =>
      new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
    return (
      <>
        {banner}
        <div className="min-h-screen bg-slate-50">
          <WorkerTopBar label={label} action={action} tabs={tabs} offline={!preview} />
          <div className="mx-auto max-w-lg px-4 py-6">
            <h1 className="text-2xl font-bold text-slate-900">Avisos</h1>
            <p className="text-sm text-slate-500">Trabajos que te asignaron o que cambiaron.</p>
            {notifications.length === 0 ? (
              <p className="mt-6 rounded-xl bg-white p-5 text-sm text-slate-500 shadow-sm">No tienes avisos.</p>
            ) : (
              <ul className="mt-4 space-y-3">
                {notifications.map((n) => (
                  <li
                    key={n.id}
                    className={`rounded-xl border bg-white p-4 shadow-sm ${n.read_at ? 'border-slate-200' : 'border-[#2C5282] ring-1 ring-[#2C5282]/30'}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm font-bold text-slate-900">
                        {n.title}
                        {!n.read_at && <span className="ml-2 rounded-full bg-[#2C5282] px-2 py-0.5 text-[11px] font-semibold text-white">Nuevo</span>}
                      </p>
                      <span className="shrink-0 text-xs text-slate-500">{when(n.created_at)}</span>
                    </div>
                    {n.body && <p className="mt-1 text-sm text-slate-600">{n.body}</p>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </>
    )
  }

  if (view === 'documentos') {
    const { data } = await ownDocuments().limit(200)
    const documents = (data || []) as StoredDocument[]
    const bookingIds = Array.from(new Set(documents.map((d) => d.booking_id).filter((id): id is string => !!id)))
    const { data: bookings } = bookingIds.length
      ? await supabaseAdmin.from('bookings').select('id, code, scheduled_date').in('id', bookingIds)
      : { data: [] as { id: string; code: string | null; scheduled_date: string | null }[] }
    const context = new Map(
      (bookings || []).map((b) => [b.id, [b.code, b.scheduled_date?.split('-').reverse().join('-')].filter(Boolean).join(' · ')])
    )
    return (
      <>
        {banner}
        <div className="min-h-screen bg-slate-50">
          <WorkerTopBar label={label} action={action} tabs={tabs} offline={!preview} />
          <div className="mx-auto max-w-lg px-4 py-6">
            <h1 className="text-2xl font-bold text-slate-900">Mis documentos</h1>
            <p className="text-sm text-slate-500">Todo lo que has subido, y tus documentos personales.</p>
            <WorkerDocuments
              documents={documents.map((d) => ({ ...d, context: d.booking_id ? context.get(d.booking_id) || 'Trabajo' : 'Documento personal' }))}
            />
          </div>
        </div>
      </>
    )
  }

  // Filtro de fechas del historial (formulario simple, sin JavaScript).
  const filtered = view === 'historial' && Boolean(searchParams.desde || searchParams.hasta)
  const { jobs, vehicles } =
    view === 'historial' ? await getWorkerHistory(worker, { from: searchParams.desde, to: searchParams.hasta }) : await getWorkerAgenda(worker)
  const jobIds = jobs.map((j) => j.id)

  const [notesByBooking, teamByBooking, modificationsByBooking, documentsResult, workLogs, deliveriesByBooking, tasks] = await Promise.all([
    getDriverNotesFor(jobIds),
    // Con quién trabaja en cada uno (solo en «Por hacer»: en el historial ya pasó).
    view === 'hacer' ? getJobTeams(jobs) : Promise.resolve(undefined),
    getWorkerModifications(worker.id, jobIds),
    jobIds.length > 0 ? ownDocuments().in('booking_id', jobIds) : Promise.resolve({ data: [] as unknown[] }),
    getWorkerWorkLogs(worker.id, jobIds),
    // Trabajos de empresas que se cierran por pallets o kilos: el trabajador anota la entrega.
    // La entrega solo se anota en trabajos que todavía puede tocar (los últimos días).
    getDeliveriesFor(
      jobs
        .filter((j) => j.scheduled_date >= new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date(Date.now() - WORKER_ACTION_DAYS * 86_400_000)))
        .map((j) => j.id)
    ),
    view === 'hacer' ? tasksForWorker({ id: worker.id, vehicle_id: worker.vehicle_id }) : Promise.resolve([]),
  ])

  const documentsByBooking = new Map<string, StoredDocument[]>()
  for (const doc of (documentsResult.data || []) as StoredDocument[]) {
    if (!doc.booking_id) continue
    documentsByBooking.set(doc.booking_id, [...(documentsByBooking.get(doc.booking_id) || []), doc])
  }

  return (
    <>
      {banner}
      <DriverAgendaView
        label={label}
        title={view === 'historial' ? 'Mi historial' : 'Trabajos por hacer'}
        subtitle={
          view === 'historial'
            ? `${filtered ? 'Fechas elegidas' : `Últimos ${WORKER_HISTORY_DAYS} días`}. Puedes agregar notas, gastos o fotos a los de los últimos ${WORKER_ACTION_DAYS} días.`
            : undefined
        }
        emptyText={
          view === 'historial'
            ? filtered
              ? 'No tienes trabajos en esas fechas.'
              : `No tienes trabajos registrados en los últimos ${WORKER_HISTORY_DAYS} días.`
            : `No tienes trabajos asignados en los próximos ${DRIVER_WINDOW_DAYS} días.`
        }
        jobs={jobs}
        vehicles={vehicles}
        notesByBooking={notesByBooking}
        teamByBooking={teamByBooking}
        documentsByBooking={documentsByBooking}
        modificationsByBooking={modificationsByBooking}
        deliveriesByBooking={preview ? undefined : deliveriesByBooking}
        // En la vista de administrador no se marca nada: se muestra el estado, sin botones.
        workLogs={workLogs.available && !preview ? workLogs : undefined}
        headerAction={action}
        tabs={tabs}
        offline={!preview}
        beforeJobs={
          view === 'historial' ? (
            <form method="get" className="mb-5 flex flex-wrap items-end gap-2 rounded-xl border border-gray-200 bg-white p-3 text-sm">
              <input type="hidden" name="vista" value="historial" />
              <label className="text-gray-600">
                Desde
                <input type="date" name="desde" defaultValue={searchParams.desde || ''} className="mt-1 block rounded-lg border border-gray-300 px-2 py-1.5" />
              </label>
              <label className="text-gray-600">
                Hasta
                <input type="date" name="hasta" defaultValue={searchParams.hasta || ''} className="mt-1 block rounded-lg border border-gray-300 px-2 py-1.5" />
              </label>
              <button type="submit" className="rounded-lg bg-[#2C5282] px-3 py-2 font-semibold text-white">
                Buscar
              </button>
              {filtered && (
                <a href="/trabajos?vista=historial" className="px-1 py-2 text-gray-500 underline">
                  Quitar fechas
                </a>
              )}
            </form>
          ) : tasks.length > 0 ? (
            <WorkerTasks initial={tasks} readOnly={Boolean(preview)} />
          ) : undefined
        }
      />
    </>
  )
}
