import { NextRequest, NextResponse } from 'next/server'
import { getActorFromRequest, logAdminAction } from '@/lib/activityLog'
import { JobTaskError, createJobTask, listJobTasks } from '@/lib/jobTasks'

export const dynamic = 'force-dynamic'

/** Tareas por camión o trabajador: las pendientes y las hechas de los últimos días. */
export async function GET() {
  try {
    return NextResponse.json(await listJobTasks())
  } catch (error) {
    console.error('[admin/jobs/tasks] Error:', error)
    return NextResponse.json({ error: 'No se pudieron cargar las tareas' }, { status: 500 })
  }
}

/** Nueva tarea. Body: `{ title, notes?, dueDate?, vehicleId? | workerId? }`. */
export async function POST(request: NextRequest) {
  const actor = getActorFromRequest(request)
  const body = await request.json().catch(() => ({}))
  try {
    const task = await createJobTask(body, actor?.username || 'administrador')
    await logAdminAction({
      actor,
      action: 'job_task.created',
      entityType: 'job_task',
      entityId: task.id,
      entityLabel: task.title,
      summary: `Creó la tarea «${task.title}» para ${task.assignee}`,
      request,
    })
    return NextResponse.json({ task })
  } catch (error) {
    if (error instanceof JobTaskError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('[admin/jobs/tasks] Error:', error)
    return NextResponse.json({ error: 'No se pudo guardar la tarea' }, { status: 500 })
  }
}
