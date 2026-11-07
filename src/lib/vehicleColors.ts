// Paleta de colores por camión: la misma identidad visual en el panel admin y en el
// link público de choferes.
//
// Los colores se aplican con estilos inline (hex) y no con clases de Tailwind a
// propósito: la clase tendría que construirse dinámicamente (`bg-${color}-600`) y el
// purge de Tailwind la eliminaría del CSS final. Con hex el color viaja igual desde la
// BD hasta el PDF si algún día se necesita ahí.

export interface VehicleColor {
  /** Clave persistida en fleet_config.vehicles[].color */
  key: string
  /** Nombre legible, para el selector del admin */
  label: string
  /** Sólido: banda de sección, punto, borde izquierdo de la tarjeta */
  hex: string
  /** Fondo suave del chip */
  soft: string
  /** Texto legible sobre `soft` */
  ink: string
}

// 8 colores bien separados en tono. Con más camiones se repiten, pero el nombre del
// camión sigue estando escrito al lado del color.
export const VEHICLE_COLORS: VehicleColor[] = [
  { key: 'azul', label: 'Azul', hex: '#2563EB', soft: '#DBEAFE', ink: '#1D4ED8' },
  { key: 'verde', label: 'Verde', hex: '#059669', soft: '#D1FAE5', ink: '#047857' },
  { key: 'ambar', label: 'Ámbar', hex: '#D97706', soft: '#FEF3C7', ink: '#B45309' },
  { key: 'violeta', label: 'Violeta', hex: '#7C3AED', soft: '#EDE9FE', ink: '#6D28D9' },
  { key: 'rosa', label: 'Rosa', hex: '#E11D48', soft: '#FFE4E6', ink: '#BE123C' },
  { key: 'cian', label: 'Cian', hex: '#0891B2', soft: '#CFFAFE', ink: '#0E7490' },
  { key: 'naranja', label: 'Naranja', hex: '#EA580C', soft: '#FFEDD5', ink: '#C2410C' },
  { key: 'lima', label: 'Lima', hex: '#65A30D', soft: '#ECFCCB', ink: '#4D7C0F' },
]

/** Trabajos sin camión asignado: gris neutro, nunca se confunde con un camión real. */
export const UNASSIGNED_COLOR: VehicleColor = {
  key: 'sin-asignar',
  label: 'Sin asignar',
  hex: '#64748B',
  soft: '#F1F5F9',
  ink: '#475569',
}

export function vehicleColorByKey(key: string | null | undefined): VehicleColor | null {
  if (!key) return null
  return VEHICLE_COLORS.find((c) => c.key === key) || null
}

/**
 * Color de un camión. Usa el guardado; si no tiene (flota creada antes de la
 * migración), cae al de su posición para que igual se vea distinto de sus vecinos.
 */
export function resolveVehicleColor(
  vehicle: { color?: string | null } | null | undefined,
  index: number
): VehicleColor {
  return (
    vehicleColorByKey(vehicle?.color) ||
    VEHICLE_COLORS[((index % VEHICLE_COLORS.length) + VEHICLE_COLORS.length) % VEHICLE_COLORS.length]
  )
}

/** Color libre siguiente al dar de alta un camión, para no repetir mientras haya cupo. */
export function nextFreeColorKey(used: Array<string | null | undefined>): string {
  const taken = new Set(used.filter(Boolean) as string[])
  return (VEHICLE_COLORS.find((c) => !taken.has(c.key)) || VEHICLE_COLORS[0]).key
}
