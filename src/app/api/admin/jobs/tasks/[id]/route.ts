import { NextRequest, NextResponse } from 'next/server'
import { getActorFromRequest, logAdminAction } from '@/lib/activityLog'
import { JobTaskError, deleteJobTask, setJobTaskDone } from '@/lib/jobTasks'

export const dynamic = 'force-dynamic'

/** Marca la tarea hecha o la vuelve a abrir. Body: `{ done: boolean }`. */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const actor = getActorFromRequest(request)
  const body = await request.json().catch(() => ({}))
  try {
    const task = await setJobTaskDone(params.id, body?.done === true, actor?.username || 'administrador')
    await logAdminAction({
      actor,
      action: task.doneAt ? 'job_task.done' : 'job_task.reopened',
      entityType: 'job_task',
      entityId: task.id,
      entityLabel: task.title,
      summary: `${task.doneAt ? 'Marcó hecha' : 'Reabrió'} la tarea «${task.title}» (${task.assignee})`,
      request,
    })
    return NextResponse.json({ task })
  } catch (error) {
    if (error instanceof JobTaskError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('[admin/jobs/tasks/id] Error:', error)
    return NextResponse.json({ error: 'No se pudo guardar' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const actor = getActorFromRequest(request)
  try {
    const { title } = await deleteJobTask(params.id)
    await logAdminAction({
      actor,
      action: 'job_task.deleted',
      entityType: 'job_task',
      entityId: params.id,
      entityLabel: title,
      summary: `Borró la tarea «${title}»`,
      request,
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof JobTaskError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('[admin/jobs/tasks/id] Error:', error)
    return NextResponse.json({ error: 'No se pudo borrar' }, { status: 500 })
  }
}
