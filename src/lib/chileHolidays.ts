/**
 * Feriados nacionales de Chile, para el recargo de feriado del cotizador.
 *
 * Lista fija y no una API en vivo: el precio se calcula en el navegador y en el servidor
 * con la misma función, y una consulta de red en medio haría que una API caída cambie el
 * precio. El costo es mantenerla: HAY QUE AGREGAR CADA AÑO NUEVO. Una fecha que no esté
 * acá simplemente no lleva recargo de feriado.
 *
 * Fuentes (consultadas el 16-09-2026): api.boostr.cl y date.nager.at, cruzadas. Las dos
 * coinciden en todas las fechas nacionales de 2026 y 2027. Quedaron fuera:
 *  - 7 de junio (Asalto y Toma del Morro de Arica): es regional, solo Arica y Parinacota.
 *  - 17-09-2027 («feriado adicional de Fiestas Patrias»): boostr y calendario.cl lo dan
 *    por la Ley 20.983, pero Nager no lo trae y en septiembre de 2026 el proyecto de ley
 *    del 17 de septiembre seguía en comisión. Mientras no esté confirmado no se cobra.
 */
const FERIADOS_NACIONALES = new Set<string>([
  // 2026
  '2026-01-01', // Año Nuevo
  '2026-04-03', // Viernes Santo
  '2026-04-04', // Sábado Santo
  '2026-05-01', // Día del Trabajo
  '2026-05-21', // Glorias Navales
  '2026-06-21', // Día Nacional de los Pueblos Indígenas
  '2026-06-29', // San Pedro y San Pablo
  '2026-07-16', // Virgen del Carmen
  '2026-08-15', // Asunción de la Virgen
  '2026-09-18', // Independencia Nacional
  '2026-09-19', // Glorias del Ejército
  '2026-10-12', // Encuentro de Dos Mundos
  '2026-10-31', // Día de las Iglesias Evangélicas y Protestantes
  '2026-11-01', // Todos los Santos
  '2026-12-08', // Inmaculada Concepción
  '2026-12-25', // Navidad
  // 2027
  '2027-01-01', // Año Nuevo
  '2027-03-26', // Viernes Santo
  '2027-03-27', // Sábado Santo
  '2027-05-01', // Día del Trabajo
  '2027-05-21', // Glorias Navales
  '2027-06-21', // Día Nacional de los Pueblos Indígenas
  '2027-06-28', // San Pedro y San Pablo
  '2027-07-16', // Virgen del Carmen
  '2027-08-15', // Asunción de la Virgen
  '2027-09-18', // Independencia Nacional
  '2027-09-19', // Glorias del Ejército
  '2027-10-11', // Encuentro de Dos Mundos
  '2027-10-31', // Día de las Iglesias Evangélicas y Protestantes
  '2027-11-01', // Todos los Santos
  '2027-12-08', // Inmaculada Concepción
  '2027-12-25', // Navidad
])

/** `YYYY-MM-DD` de un día de Chile. */
export function isChileHoliday(dateKey: string): boolean {
  return FERIADOS_NACIONALES.has(dateKey)
}

/**
 * Día calendario en Chile (`YYYY-MM-DD`) de la fecha de una mudanza.
 *
 * Un texto sin zona horaria («2026-09-20» o «2026-09-20T10:00») se toma tal cual, como
 * hora de Chile: pasado por `new Date` se leería en UTC y a las 21:00 del sábado ya sería
 * domingo. Un `Date` o un ISO con zona se lleva a la hora de Santiago, que es la del
 * cliente del navegador y no la del servidor (Vercel corre en UTC).
 */
export function chileDateKey(value: string | Date | null | undefined): string | null {
  if (!value) return null
  if (typeof value === 'string') {
    const sinZona = /^(\d{4}-\d{2}-\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)?$/.exec(value.trim())
    if (sinZona) return sinZona[1]
  }
  const fecha = new Date(value)
  if (Number.isNaN(fecha.getTime())) return null
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(fecha)
}

/** 0 = domingo … 6 = sábado, de un `YYYY-MM-DD`. */
export function dayOfWeekFromKey(dateKey: string): number {
  return new Date(`${dateKey}T12:00:00Z`).getUTCDay()
}
