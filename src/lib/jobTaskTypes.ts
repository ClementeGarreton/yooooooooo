// Tareas por camión o por trabajador (panel Trabajos). SIN dependencias de servidor.

export interface JobTask {
  id: string
  title: string
  notes: string | null
  /** 'AAAA-MM-DD'. null = sin fecha. */
  dueDate: string | null
  vehicleId: number | null
  workerId: string | null
  /** Nombre del camión o del trabajador, para mostrarla. */
  assignee: string
  doneAt: string | null
  doneBy: string | null
  createdBy: string | null
  createdAt: string
}

export interface JobTaskOptions {
  vehicles: { id: number; name: string }[]
  workers: { id: string; name: string; active: boolean }[]
}

export interface JobTasksData extends JobTaskOptions {
  /** false = falta correr add_tareas.sql. */
  available: boolean
  tasks: JobTask[]
}
