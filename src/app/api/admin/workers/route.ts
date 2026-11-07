import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getActorFromRequest, logAdminAction } from '@/lib/activityLog'
import { hashPassword } from '@/lib/passwordHash'
import {
  WORKER_FIELDS,
  WORKER_PIN_HELP,
  WORKER_PIN_RE,
  WorkerError,
  getWorkerEmails,
  getWorkerRoles,
  parseWorkerEmail,
  parseWorkerInput,
  parseWorkerRole,
  saveWorkerEmail,
  saveWorkerRole,
} from '@/lib/workers'
import { isFieldRole } from '@/lib/workerRoles'

export const dynamic = 'force-dynamic'

/** Trabajadores, para la pestaña Flota del admin (sesión: middleware). Nunca devuelve el PIN. */
export async function GET() {
  const { data, error } = await supabaseAdmin.from('workers').select(WORKER_FIELDS).order('name')
  if (error) {
    console.error('[admin/workers] Error listando:', error)
    return NextResponse.json({ error: 'No se pudieron cargar los trabajadores' }, { status: 500 })
  }
  const [emails, roles] = await Promise.all([getWorkerEmails(), getWorkerRoles()])
  return NextResponse.json({
    workers: (data || []).map((w) => ({ ...w, email: emails.get(w.id) ?? null, role: roles.get(w.id) ?? 'terreno' })),
  })
}

/** Crea un trabajador con su PIN. Body: `{ name, rut, phone?, vehicle_id?, role?, pin }`. */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const input = parseWorkerInput(body)
    const email = parseWorkerEmail(body)
    const role = parseWorkerRole(body)
    // Administrativos, contador y externos no tienen camión habitual.
    if (role && !isFieldRole(role)) input.vehicle_id = null
    const pin = String(body?.pin || '').trim()
    if (!WORKER_PIN_RE.test(pin)) throw new WorkerError(WORKER_PIN_HELP)

    const { data, error } = await supabaseAdmin
      .from('workers')
      .insert({ ...input, pin_hash: await hashPassword(pin) })
      .select(WORKER_FIELDS)
      .single()
    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: 'Ya existe un trabajador con ese RUT.' }, { status: 409 })
      }
      throw error
    }

    await logAdminAction({
      actor: getActorFromRequest(request),
      action: 'worker.created',
      entityType: 'worker',
      entityId: data.id,
      entityLabel: `${data.name} (${data.code})`,
      summary: `Creó al trabajador ${data.name}`,
      // El PIN no va al log, ni en claro ni su hash.
      changes: { created: { from: null, to: input } },
      request,
    })
    if (email) await saveWorkerEmail(data.id, email)
    if (role && role !== 'terreno') await saveWorkerRole(data.id, role)
    return NextResponse.json({ worker: data }, { status: 201 })
  } catch (error) {
    if (error instanceof WorkerError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('[admin/workers] Error creando:', error)
    return NextResponse.json({ error: 'No se pudo crear el trabajador' }, { status: 500 })
  }
}
