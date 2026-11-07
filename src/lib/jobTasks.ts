/**
 * Tareas por camión o por trabajador (Francisco, 20-10-2026): cosas por hacer que no son una
 * reserva, «casi como notas». Se cargan en Trabajos → Tareas y el trabajador las ve en su
 * agenda de /trabajos (las suyas y las de su camión habitual) y las marca hechas.
 */

import { supabaseAdmin } from '@/lib/supabase'
import { getFleetVehicleViews } from '@/lib/vehicleAssignment'
import type { JobTask, JobTaskOptions, JobTasksData } from '@/lib/jobTaskTypes'

export class JobTaskError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message)
    this.name = 'JobTaskError'
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
/** Las hechas se siguen mostrando unos días, para ver qué se hizo. */
const DONE_VISIBLE_DAYS = 7

async function loadOptions(): Promise<JobTaskOptions> {
  const [vehicles, { data: workers }] = await Promise.all([
    getFleetVehicleViews(),
    supabaseAdmin.from('workers').select('id, name, active').order('name'),
  ])
  return {
    vehicles: vehicles.map((v) => ({ id: v.id, name: v.name })),
    workers: ((workers || []) as { id: string; name: string; active: boolean }[]).map((w) => ({ id: w.id, name: w.name, active: w.active !== false })),
  }
}

async function names(options?: JobTaskOptions): Promise<{ vehicle: Map<number, string>; worker: Map<string, string> }> {
  const o = options || (await loadOptions())
  return { vehicle: new Map(o.vehicles.map((v) => [v.id, v.name])), worker: new Map(o.workers.map((w) => [w.id, w.name])) }
}

function toTask(row: any, n: { vehicle: Map<number, string>; worker: Map<string, string> }): JobTask {
  const assignee = row.worker_id
    ? n.worker.get(row.worker_id) || 'Trabajador'
    : row.vehicle_id !== null && row.vehicle_id !== undefined
      ? n.vehicle.get(row.vehicle_id) || `Camión ${row.vehicle_id}`
      : '—'
  return {
    id: row.id,
    title: row.title,
    notes: row.notes ?? null,
    dueDate: row.due_date ?? null,
    vehicleId: row.vehicle_id ?? null,
    workerId: row.worker_id ?? null,
    assignee,
    doneAt: row.done_at ?? null,
    doneBy: row.done_by ?? null,
    createdBy: row.created_by ?? null,
    createdAt: row.created_at,
  }
}

const sortTasks = (a: JobTask, b: JobTask) =>
  Number(Boolean(a.doneAt)) - Number(Boolean(b.doneAt)) || (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || a.createdAt.localeCompare(b.createdAt)

/**
 * Para el panel: las pendientes y las hechas de los últimos días, con los camiones y
 * trabajadores para elegir a quién va. `available` = existe la tabla.
 */
export async function listJobTasks(): Promise<JobTasksData> {
  const since = new Date(Date.now() - DONE_VISIBLE_DAYS * 86_400_000).toISOString()
  const [{ data, error }, options] = await Promise.all([
    supabaseAdmin.from('job_tasks').select('*').or(`done_at.is.null,done_at.gte.${since}`).limit(1000),
    loadOptions(),
  ])
  if (error) return { available: false, tasks: [], ...options }
  const n = await names(options)
  return { available: true, tasks: ((data || []) as any[]).map((r) => toTask(r, n)).sort(sortTasks), ...options }
}

/** Las de un trabajador: las suyas y las de su camión habitual (pendientes y hechas hace poco). */
export async function tasksForWorker(worker: { id: string; vehicle_id: number | null }): Promise<JobTask[]> {
  const since = new Date(Date.now() - DONE_VISIBLE_DAYS * 86_400_000).toISOString()
  const who = worker.vehicle_id !== null ? `worker_id.eq.${worker.id},vehicle_id.eq.${worker.vehicle_id}` : `worker_id.eq.${worker.id}`
  const { data, error } = await supabaseAdmin.from('job_tasks').select('*').or(who).or(`done_at.is.null,done_at.gte.${since}`).limit(200)
  if (error) return []
  const n = await names()
  return ((data || []) as any[]).map((r) => toTask(r, n)).sort(sortTasks)
}

/** Body: `{ title, notes?, dueDate?, vehicleId? | workerId? }`. */
export async function createJobTask(body: any, actor: string): Promise<JobTask> {
  const title = typeof body?.title === 'string' ? body.title.trim().slice(0, 200) : ''
  if (!title) throw new JobTaskError('Escribe qué hay que hacer.')
  const notes = typeof body?.notes === 'string' ? body.notes.trim().slice(0, 2000) || null : null
  const dueDate = body?.dueDate ? String(body.dueDate) : null
  if (dueDate && !DAY_RE.test(dueDate)) throw new JobTaskError('La fecha no es válida.')
  const workerId = typeof body?.workerId === 'string' && UUID_RE.test(body.workerId) ? body.workerId : null
  const vehicleId = workerId ? null : Number.isInteger(Number(body?.vehicleId)) && body?.vehicleId !== '' && body?.vehicleId !== null ? Number(body.vehicleId) : null
  if (!workerId && vehicleId === null) throw new JobTaskError('Elige un camión o un trabajador.')
  const { data, error } = await supabaseAdmin
    .from('job_tasks')
    .insert({ title, notes, due_date: dueDate, vehicle_id: vehicleId, worker_id: workerId, created_by: actor })
    .select('*')
    .single()
  if (error || !data) {
    if (error?.code === '42P01' || error?.code === 'PGRST205') throw new JobTaskError('Falta correr la migración add_tareas.sql.', 409)
    throw new JobTaskError('No se pudo guardar la tarea.', 500)
  }
  return toTask(data, await names())
}

/** Marca hecha o la vuelve a abrir. `onlyFor` = un trabajador: solo las suyas o las de su camión. */
export async function setJobTaskDone(
  id: unknown,
  done: boolean,
  actor: string,
  onlyFor?: { id: string; vehicle_id: number | null }
): Promise<JobTask> {
  if (typeof id !== 'string' || !UUID_RE.test(id)) throw new JobTaskError('Tarea no encontrada', 404)
  const { data: row } = await supabaseAdmin.from('job_tasks').select('*').eq('id', id).maybeSingle()
  if (!row) throw new JobTaskError('Tarea no encontrada', 404)
  if (onlyFor && row.worker_id !== onlyFor.id && !(onlyFor.vehicle_id !== null && row.vehicle_id === onlyFor.vehicle_id)) {
    throw new JobTaskError('Tarea no encontrada', 404)
  }
  const { data, error } = await supabaseAdmin
    .from('job_tasks')
    .update(done ? { done_at: new Date().toISOString(), done_by: actor } : { done_at: null, done_by: null })
    .eq('id', id)
    .select('*')
    .single()
  if (error || !data) throw new JobTaskError('No se pudo guardar.', 500)
  return toTask(data, await names())
}

export async function deleteJobTask(id: unknown): Promise<{ title: string }> {
  if (typeof id !== 'string' || !UUID_RE.test(id)) throw new JobTaskError('Tarea no encontrada', 404)
  const { data } = await supabaseAdmin.from('job_tasks').delete().eq('id', id).select('title').maybeSingle()
  if (!data) throw new JobTaskError('Tarea no encontrada', 404)
  return { title: data.title }
}
