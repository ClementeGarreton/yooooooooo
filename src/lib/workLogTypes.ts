// Inicio y fin de un trabajo, tal como lo ve el trabajador. SIN dependencias de servidor.

export interface WorkLog {
  bookingId: string
  startedAt: string
  finishedAt: string | null
}

/** El trabajo que el trabajador tiene iniciado y sin finalizar (si lo hay). */
export interface OpenWork {
  bookingId: string
  startedAt: string
  /** «RES-000123 · Juan Pérez · 08-10», para que sepa cuál le falta finalizar. */
  label: string
}

export function formatWorkTime(iso: string): string {
  return new Intl.DateTimeFormat('es-CL', {
    timeZone: 'America/Santiago',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
}
