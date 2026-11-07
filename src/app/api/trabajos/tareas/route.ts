import { NextRequest, NextResponse } from 'next/server'
import { logAdminAction } from '@/lib/activityLog'
import { getSessionWorker } from '@/lib/workerSession'
import { JobTaskError, setJobTaskDone, tasksForWorker } from '@/lib/jobTasks'

export const dynamic = 'force-dynamic'

/** Las tareas del trabajador con sesión: las suyas y las de su camión habitual. */
export async function GET() {
  const worker = await getSessionWorker()
  if (!worker) return NextResponse.json({ error: 'Tu sesión venció. Vuelve a entrar.' }, { status: 401 })
  return NextResponse.json({ tasks: await tasksForWorker({ id: worker.id, vehicle_id: worker.vehicle_id ?? null }) })
}

/** Marca hecha (o deshace) una tarea suya o de su camión. Body: `{ id, done }`. */
export async function PATCH(request: NextRequest) {
  const worker = await getSessionWorker()
  if (!worker) return NextResponse.json({ error: 'Tu sesión venció. Vuelve a entrar.' }, { status: 401 })
  const body = await request.json().catch(() => ({}))
  const label = `${worker.name} · ${worker.code}`
  try {
    const task = await setJobTaskDone(body?.id, body?.done === true, label, { id: worker.id, vehicle_id: worker.vehicle_id ?? null })
    await logAdminAction({
      actor: { username: label },
      action: task.doneAt ? 'job_task.done' : 'job_task.reopened',
      entityType: 'job_task',
      entityId: task.id,
      entityLabel: task.title,
      summary: `${worker.name} ${task.doneAt ? 'marcó hecha' : 'reabrió'} la tarea «${task.title}»`,
      request,
    })
    return NextResponse.json({ task })
  } catch (error) {
    if (error instanceof JobTaskError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('[trabajos/tareas] Error:', error)
    return NextResponse.json({ error: 'No pudimos guardar. Intenta de nuevo.' }, { status: 500 })
  }
}
