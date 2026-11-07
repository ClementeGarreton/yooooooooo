import type { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

// Registro de actividad del panel (quién hizo qué y cuándo).
// Diseño: docs/DISENO_USUARIOS_Y_AUDITORIA.md
//
// REGLA DE ORO: registrar NUNCA puede romper la operación del usuario. Si falla la
// escritura del log, se reporta por consola y la acción sigue su curso. Un log caído no
// puede impedir que se confirme una reserva.

export type ActivityResult = 'success' | 'denied' | 'error'

export interface ActivityActor {
  username: string
  id?: string | null
}

export interface FieldChange {
  from: unknown
  to: unknown
}

export interface LogActionParams {
  actor: ActivityActor | null
  /** Acción en formato entidad.verbo (ver catálogo en el documento de diseño). */
  action: string
  entityType?: string
  entityId?: string | null
  /** Etiqueta legible, se guarda duplicada para poder leer el log a futuro. */
  entityLabel?: string | null
  summary: string
  changes?: Record<string, FieldChange> | null
  result?: ActivityResult
  request?: NextRequest | null
}

/** Identidad inyectada por el middleware desde la cookie firmada (no del body). */
export function getActorFromRequest(request: NextRequest): ActivityActor | null {
  const username = request.headers.get('x-admin-user')
  if (!username) return null
  return { username, id: request.headers.get('x-admin-user-id') }
}

function getIp(request: NextRequest): string | null {
  const real = request.headers.get('x-real-ip')
  if (real) return real.trim()
  const fwd = request.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0]?.trim() || null
  return request.ip || null
}

export async function logAdminAction(params: LogActionParams): Promise<void> {
  try {
    const { request } = params

    // Supabase devuelve el error en la respuesta (no lanza), así que hay que mirarlo
    // explícitamente: si no, un log roto pasaría totalmente inadvertido.
    const { error } = await supabaseAdmin.from('admin_activity_log').insert({
      actor_username: params.actor?.username || 'sistema',
      actor_id: params.actor?.id || null,
      action: params.action,
      entity_type: params.entityType || null,
      entity_id: params.entityId ? String(params.entityId) : null,
      entity_label: params.entityLabel || null,
      summary: params.summary,
      changes: params.changes && Object.keys(params.changes).length ? params.changes : null,
      ip: request ? getIp(request) : null,
      user_agent: request?.headers.get('user-agent')?.slice(0, 500) || null,
      request_path: request?.nextUrl?.pathname || null,
      result: params.result || 'success',
    })

    if (error) {
      console.error(
        `[activityLog] No se pudo registrar "${params.action}":`,
        error.message || error
      )
    }
  } catch (error) {
    // Nunca propagamos: el log es secundario respecto de la operación.
    console.error('[activityLog] No se pudo registrar la actividad:', error)
  }
}

/**
 * Compara dos versiones de un registro y devuelve solo los campos que cambiaron.
 * Mantener el diff acotado hace el log legible y evita guardar datos personales de más.
 */
export function diffFields<T extends Record<string, any>>(
  before: T | null | undefined,
  after: Record<string, any>,
  fields: string[]
): Record<string, FieldChange> {
  const changes: Record<string, FieldChange> = {}
  if (!before) return changes

  for (const field of fields) {
    if (!(field in after)) continue
    const prev = before[field]
    const next = after[field]
    // Comparación laxa por string: evita marcar cambios por 100 vs "100".
    if (prev === next) continue
    if (prev == null && next == null) continue
    if (String(prev ?? '') === String(next ?? '')) continue
    changes[field] = { from: prev ?? null, to: next ?? null }
  }

  return changes
}

/** Etiquetas legibles de estados, para que el resumen no muestre el valor crudo. */
export const STATUS_LABELS: Record<string, string> = {
  pending: 'Pendiente',
  confirmed: 'Confirmado',
  completed: 'Completado',
  cancelled: 'Cancelado',
  no_show: 'No atendido',
  new: 'Nuevo',
  contacted: 'Contactado',
  no_response: 'Sin respuesta',
  converted: 'Convertido',
  lost: 'Perdido',
  approved: 'Aprobado',
  rejected: 'Rechazado',
}

export function statusLabel(value?: string | null): string {
  if (!value) return '—'
  return STATUS_LABELS[value] || value
}
