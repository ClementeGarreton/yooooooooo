/**
 * Formato mínimo de un correo: algo@algo.dominio, sin espacios.
 *
 * No pretende validar que el correo exista: frena lo que medimos que pasaba — en 9 de 98
 * reservas manuales (14-sep-2026) el campo tenía un nombre o una palabra («dorca»,
 * «sinnumero»), y a esos clientes no les llega ningún correo. Es la misma regla con la
 * que el #05 decide si a una reserva se le puede escribir, así que lo que se acepta al
 * crear es lo que después se puede usar.
 */
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function isValidEmail(value: unknown): boolean {
  return EMAIL_RE.test(String(value ?? '').trim())
}
