/**
 * PRECIO DE LA VISITA A DOMICILIO
 *
 * Los $23.000 de la cotización a domicilio estaban escritos a mano en siete lugares
 * (el cobro, la landing, la pantalla de bienvenida del cotizador y el PDF), así que
 * cambiarlos exigía un deploy. Tomás pidió el 28-ago-2026 poder editarlos desde el
 * panel como cualquier otro precio.
 *
 * Se guarda dentro del JSONB `pricing_config.additional_services`, igual que los
 * cobros de septiembre: la columna ya existe, así que NO hace falta migración y una
 * fila anterior simplemente no trae la clave y se completa con el valor por defecto.
 * No es un "servicio adicional" de la mudanza —es el precio de otro producto— y por
 * eso no aparece en la lista de extras del cotizador: cada consumidor de esa columna
 * nombra las claves que usa, ninguno las recorre.
 *
 * El valor por defecto acompaña al precio vigente (33.000 desde el 23-sep-2026, pedido
 * de Tomás): si la configuración no se puede leer, la página cobra lo que corresponde
 * hoy en vez de romperse, cobrar cero o volver a un precio viejo. Medido el 23-sep, la
 * configuración de producción NO tiene guardada la clave `homeVisitPrice`, así que este
 * default es el que se está cobrando de verdad.
 */

export const DEFAULT_HOME_VISIT_PRICE = 33000

/**
 * Normaliza el precio leído de la base o de la API.
 *
 * Rechaza 0 y los negativos, que acá no significan "servicio apagado" como en los
 * extras de la mudanza: la visita a domicilio se cobra siempre, y un 0 mandaría al
 * cliente a pagar nada a Flow.
 */
export function normalizeHomeVisitPrice(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : DEFAULT_HOME_VISIT_PRICE
}

/** El precio como se escribe en pantalla: "$33.000". */
export function formatHomeVisitPrice(value: number): string {
  return `$${normalizeHomeVisitPrice(value).toLocaleString('es-CL')}`
}
