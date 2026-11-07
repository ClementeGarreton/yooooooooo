import { describe, expect, it } from 'vitest'
import { formatRut, isValidRut, normalizeRut, rutCheckDigit } from '@/lib/rut'

// Oráculo independiente del dígito verificador, escrito de la especificación
// (módulo 11 con factores 2..7): si lib/rut.ts se desvía, esta suite lo avisa.
const dvEspejo = (body: number): string => {
  let suma = 0
  let factor = 2
  let n = body
  while (n > 0) {
    suma += (n % 10) * factor
    n = Math.floor(n / 10)
    factor = factor === 7 ? 2 : factor + 1
  }
  const resto = 11 - (suma % 11)
  return resto === 11 ? '0' : resto === 10 ? 'K' : String(resto)
}

describe('rutCheckDigit', () => {
  it('coincide con el oráculo de la especificación en 500 cuerpos', () => {
    for (let body = 100000; body < 100500; body++) {
      expect(rutCheckDigit(body)).toBe(dvEspejo(body))
    }
  })
})

describe('isValidRut', () => {
  it('valida cualquier cuerpo con su DV correcto, en cualquier formato', () => {
    for (const body of [100000, 76452118, 22726009, 9999999, 1234567]) {
      const dv = dvEspejo(body)
      const conPuntos = body.toLocaleString('es-CL') // '76.452.118'
      expect(isValidRut(`${body}-${dv}`)).toBe(true)
      expect(isValidRut(`${body}${dv}`)).toBe(true)
      expect(isValidRut(`${conPuntos}-${dv}`)).toBe(true)
      expect(isValidRut(`${body}-${dv.toLowerCase()}`)).toBe(true)
    }
  })
  it('rechaza DV incorrecto, cuerpo corto y basura', () => {
    expect(isValidRut('76452118-0')).toBe(false) // DV real es 9
    expect(isValidRut('99999-9')).toBe(false) // cuerpo < 100000
    expect(isValidRut('')).toBe(false)
    expect(isValidRut(null)).toBe(false)
    expect(isValidRut('no-es-rut')).toBe(false)
    expect(isValidRut({})).toBe(false)
  })
})

describe('normalizeRut / formatRut', () => {
  it('normaliza a cuerpo-guion-dv sin ceros a la izquierda', () => {
    expect(normalizeRut('76.452.118-9')).toBe('76452118-9')
    expect(normalizeRut('764521189')).toBe('76452118-9')
    expect(normalizeRut('76452118k')).toBe('76452118-K')
    expect(normalizeRut('00123456-7')).toBe('123456-7')
    expect(normalizeRut('sin forma')).toBe('')
    expect(normalizeRut('')).toBe('')
  })
  it('formatea con puntos para mostrar y deja la basura intacta', () => {
    expect(formatRut('76452118-9')).toBe('76.452.118-9')
    expect(formatRut('no-es-rut')).toBe('no-es-rut')
  })
})
