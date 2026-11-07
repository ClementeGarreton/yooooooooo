// Tipos de los avisos a trabajadores, SIN dependencias de servidor.

export type WorkerNotificationKind = 'assigned' | 'removed' | 'rescheduled' | 'cancelled'

export interface WorkerNotification {
  id: string
  booking_id: string | null
  kind: WorkerNotificationKind
  title: string
  body: string | null
  created_at: string
  read_at: string | null
}
