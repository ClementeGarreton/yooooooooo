// Tipo de trabajador (add_tipo_trabajador.sql, add_categorias_trabajador.sql). SIN dependencias de servidor.

/**
 * 'terreno' es el valor de antes de las categorías (Tomás, 27-10-2026: «administrativo, choferes y
 * pionetas»): quien lo tenga va a terreno igual, pero falta decir si es chofer o peoneta.
 * 'secretaria' tampoco se ofrece más: es administrativo.
 */
export type WorkerRole = 'chofer' | 'peoneta' | 'administrativo' | 'contador' | 'externo' | 'terreno' | 'secretaria'

/** Lo que se puede elegir. */
export const WORKER_ROLES: { value: WorkerRole; label: string }[] = [
  { value: 'chofer', label: 'Chofer' },
  { value: 'peoneta', label: 'Peoneta' },
  { value: 'administrativo', label: 'Administrativo' },
  { value: 'contador', label: 'Contador' },
  { value: 'externo', label: 'Externo' },
]

export const WORKER_ROLE_LABEL: Record<WorkerRole, string> = {
  chofer: 'Chofer',
  peoneta: 'Peoneta',
  administrativo: 'Administrativo',
  contador: 'Contador',
  externo: 'Externo',
  terreno: 'En terreno (falta categoría)',
  secretaria: 'Secretaria',
}

export const isWorkerRole = (value: unknown): value is WorkerRole => typeof value === 'string' && value in WORKER_ROLE_LABEL

/** ¿Va a los trabajos? Solo choferes y peonetas tienen camión y se asignan a cuadrillas. */
export const isFieldRole = (role: WorkerRole | null | undefined) => !role || role === 'terreno' || role === 'chofer' || role === 'peoneta'
