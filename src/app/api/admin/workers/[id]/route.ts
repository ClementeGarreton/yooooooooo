import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { diffFields, getActorFromRequest, logAdminAction } from '@/lib/activityLog'
import { hashPassword } from '@/lib/passwordHash'
import {
  UUID_RE,
  WORKER_FIELDS,
  WORKER_PIN_HELP,
  WORKER_PIN_RE,
  WorkerError,
  parseWorkerEmail,
  getWorkerRoles,
  parseWorkerInput,
  parseWorkerRole,
  saveWorkerEmail,
  saveWorkerRole,
} from '@/lib/workers'
import { WORKER_ROLE_LABEL, isFieldRole } from '@/lib/workerRoles'

export const dynamic = 'force-dynamic'

/**
 * Edita un trabajador. Body: cualquiera de `{ name, rut, phone, vehicle_id, role, active, pin }`.
 * Cambiar el PIN o desactivarlo cierra sus sesiones abiertas (ver workerSession.ts).
 */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  if (!UUID_RE.test(params.id)) return NextResponse.json({ error: 'Trabajador no encontrado' }, { status: 404 })
  try {
    const body = await request.json()
    const input = parseWorkerInput(body, true)
    const email = parseWorkerEmail(body)
    const role = parseWorkerRole(body)
    // Administrativos, contador y externos no tienen camión habitual.
    if (role && !isFieldRole(role)) input.vehicle_id = null
    const update: Record<string, unknown> = { ...input }

    const pinChanged = body?.pin !== undefined && String(body.pin).trim() !== ''
    if (pinChanged) {
      const pin = String(body.pin).trim()
      if (!WORKER_PIN_RE.test(pin)) throw new WorkerError(WORKER_PIN_HELP)
      update.pin_hash = await hashPassword(pin)
    }
    if (Object.keys(update).length === 0 && email === undefined && role === undefined) {
      return NextResponse.json({ error: 'Nada que cambiar' }, { status: 400 })
    }

    const { data: before } = await supabaseAdmin.from('workers').select(WORKER_FIELDS).eq('id', params.id).maybeSingle()
    if (!before) return NextResponse.json({ error: 'Trabajador no encontrado' }, { status: 404 })

    const { data, error } = await supabaseAdmin
      .from('workers')
      .update({ ...update, updated_at: new Date().toISOString() })
      .eq('id', params.id)
      .select(WORKER_FIELDS)
      .single()
    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: 'Ya existe un trabajador con ese RUT.' }, { status: 409 })
      }
      throw error
    }

    const actor = getActorFromRequest(request)
    const label = `${data.name} (${data.code})`
    const changes = diffFields(before, input, Object.keys(input))
    if (changes && Object.keys(changes).length > 0) {
      await logAdminAction({
        actor,
        action: input.active === false ? 'worker.deactivated' : 'worker.updated',
        entityType: 'worker',
        entityId: data.id,
        entityLabel: label,
        summary: input.active === false ? `Desactivó a ${data.name}` : `Editó al trabajador ${data.name}`,
        changes,
        request,
      })
    }
    if (pinChanged) {
      await logAdminAction({
        actor,
        action: 'worker.pin_changed',
        entityType: 'worker',
        entityId: data.id,
        entityLabel: label,
        summary: `Cambió el PIN de ${data.name}`,
        request,
      })
    }
    if (email !== undefined) await saveWorkerEmail(data.id, email)
    if (role !== undefined) {
      const previous = (await getWorkerRoles()).get(data.id) ?? 'terreno'
      if (previous !== role) {
        await saveWorkerRole(data.id, role)
        await logAdminAction({
          actor,
          action: 'worker.updated',
          entityType: 'worker',
          entityId: data.id,
          entityLabel: label,
          summary: `Cambió a ${data.name} de ${WORKER_ROLE_LABEL[previous]} a ${WORKER_ROLE_LABEL[role]}`,
          changes: { tipo: { from: WORKER_ROLE_LABEL[previous], to: WORKER_ROLE_LABEL[role] } },
          request,
        })
      }
    }
    return NextResponse.json({ worker: data })
  } catch (error) {
    if (error instanceof WorkerError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('[admin/workers] Error editando:', error)
    return NextResponse.json({ error: 'No se pudo guardar el trabajador' }, { status: 500 })
  }
}
