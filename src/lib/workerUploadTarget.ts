/**
 * A qué se asocia lo que escribe el trabajador (archivo, diferencia). Dos casos:
 *  - Con reserva: tiene que ser un trabajo SUYO — de su agenda de los próximos días o de
 *    los últimos días (la rendición de gastos se hace después del servicio). Se comprueba
 *    con `workerCanActOn`, la misma regla que pinta su pantalla.
 *  - Sin reserva (`allowPersonal`): un documento personal del trabajador (licencia,
 *    certificado), que no pertenece a ningún servicio.
 */

import { getSessionWorker } from '@/lib/workerSession'
import { workerCanActOn } from '@/lib/workerJobs'
import type { Worker } from '@/lib/workers'

export type WorkerUploadTarget =
  | { ok: true; worker: Worker; folder: string; bookingId: string | null; label: string }
  | { ok: false; status: number; error: string }

export async function resolveWorkerUploadTarget(
  rawBookingId: unknown,
  options: { allowPersonal?: boolean } = {}
): Promise<WorkerUploadTarget> {
  const worker = await getSessionWorker()
  if (!worker) return { ok: false, status: 401, error: 'Tu sesión venció. Vuelve a entrar.' }

  const bookingId = String(rawBookingId || '')
  const base = { ok: true as const, worker, folder: `trabajadores/${worker.id}`, label: `${worker.name} · ${worker.code}` }
  if (!bookingId) {
    return options.allowPersonal ? { ...base, bookingId: null } : { ok: false, status: 400, error: 'Falta indicar el trabajo' }
  }
  if (!(await workerCanActOn(worker, bookingId))) {
    return { ok: false, status: 403, error: 'Ese trabajo no es tuyo o ya pasó hace mucho' }
  }
  return { ...base, bookingId }
}
