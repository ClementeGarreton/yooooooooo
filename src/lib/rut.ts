/**
 * RUT chileno. En la base se guarda siempre normalizado: sin puntos, con guion y la K en
 * mayúscula (76452118-9), para que el UNIQUE de `companies.rut` y `workers.rut` no deje
 * pasar el mismo RUT escrito de dos formas.
 */

/** '76.452.118-9' | '764521189' → '76452118-9'. Devuelve '' si no tiene forma de RUT. */
export function normalizeRut(value: unknown): string {
  const clean = String(value ?? '').replace(/[^0-9kK]/g, '').toUpperCase()
  if (clean.length < 2 || !/^\d+[0-9K]$/.test(clean)) return ''
  return `${Number(clean.slice(0, -1))}-${clean.slice(-1)}`
}

/** Dígito verificador (módulo 11) del cuerpo de un RUT. */
export function rutCheckDigit(body: number): string {
  let sum = 0
  let factor = 2
  for (let n = body; n > 0; n = Math.floor(n / 10)) {
    sum += (n % 10) * factor
    factor = factor === 7 ? 2 : factor + 1
  }
  const rest = 11 - (sum % 11)
  return rest === 11 ? '0' : rest === 10 ? 'K' : String(rest)
}

/** ¿Es un RUT con dígito verificador correcto? Acepta cualquier formato de escritura. */
export function isValidRut(value: unknown): boolean {
  const rut = normalizeRut(value)
  if (!rut) return false
  const [body, dv] = rut.split('-')
  const n = Number(body)
  return n >= 100000 && rutCheckDigit(n) === dv
}

/** '76452118-9' → '76.452.118-9', para mostrar. */
export function formatRut(value: unknown): string {
  const rut = normalizeRut(value)
  if (!rut) return String(value ?? '')
  const [body, dv] = rut.split('-')
  return `${Number(body).toLocaleString('es-CL')}-${dv}`
}
