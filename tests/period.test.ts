import { describe, expect, it } from 'vitest'
import { addDays, chileDayOf, inPeriod, monthRange, periodOf, resolvePeriod, todayChile } from '@/lib/period'

describe('addDays', () => {
  it('cruza el año sin pasar por UTC', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31')
  })
  it('cruza el mes recortando al último día', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })
})

describe('resolvePeriod', () => {
  const today = '2026-11-04' // miércoles
  it('Hoy y Mañana', () => {
    expect(resolvePeriod(periodOf('day'), today)).toMatchObject({ from: '2026-11-04', to: '2026-11-04' })
    expect(resolvePeriod(periodOf('tomorrow'), today)).toMatchObject({ from: '2026-11-05', to: '2026-11-05' })
    expect(resolvePeriod(periodOf('tomorrow'), '2026-12-31')).toMatchObject({ from: '2027-01-01', to: '2027-01-01' })
  })
  it('Semana va de lunes a domingo', () => {
    expect(resolvePeriod(periodOf('week'), today)).toMatchObject({ from: '2026-11-02', to: '2026-11-08' })
    expect(resolvePeriod(periodOf('week'), '2026-11-02')).toMatchObject({ from: '2026-11-02', to: '2026-11-08' }) // lunes
    expect(resolvePeriod(periodOf('week'), '2026-11-08')).toMatchObject({ from: '2026-11-02', to: '2026-11-08' }) // domingo
  })
  it('Mes toma el mes calendario completo', () => {
    expect(resolvePeriod(periodOf('month'), '2026-02-10')).toMatchObject({ from: '2026-02-01', to: '2026-02-28' })
    expect(resolvePeriod(periodOf('month'), '2026-12-05')).toMatchObject({ from: '2026-12-01', to: '2026-12-31' })
  })
  it('Rango invertido se ordena solo; una punta alcanzada vale', () => {
    expect(resolvePeriod(periodOf('custom', '2026-05-10', '2026-05-01'), today)).toMatchObject({ from: '2026-05-01', to: '2026-05-10' })
    expect(resolvePeriod(periodOf('custom', '2026-05-10', ''), today)).toMatchObject({ from: '2026-05-10', to: null })
  })
  it('Todo no filtra', () => {
    expect(resolvePeriod(periodOf('all'), today)).toMatchObject({ from: null, to: null })
  })
})

describe('inPeriod', () => {
  it('incluiría los bordes y rechazaría lo de afuera', () => {
    const range = resolvePeriod(periodOf('custom', '2026-05-01', '2026-05-10'), '2026-05-04')
    expect(inPeriod('2026-05-01', range)).toBe(true)
    expect(inPeriod('2026-05-10', range)).toBe(true)
    expect(inPeriod('2026-04-30', range)).toBe(false)
    expect(inPeriod('2026-05-11', range)).toBe(false)
    expect(inPeriod('2026-05-04T18:30:00', range)).toBe(true) // timestamps comparan por los primeros 10 caracteres
    expect(inPeriod(null, range)).toBe(false)
  })
  it('sin filtro pasa todo, incluida la ausencia de fecha', () => {
    expect(inPeriod(null, { from: null, to: null, label: '' })).toBe(true)
  })
})

describe('chileDayOf / todayChile', () => {
  it('traduce UTC a día de Chile (invierno: UTC-4)', () => {
    expect(chileDayOf('2026-07-15T03:00:00Z')).toBe('2026-07-14') // 23:00 del día anterior
    expect(chileDayOf('2026-07-15T05:00:00Z')).toBe('2026-07-15') // 01:00 del mismo día
  })
  it('devuelve vacío sin fecha válida', () => {
    expect(chileDayOf(null)).toBe('')
    expect(chileDayOf('')).toBe('')
    expect(chileDayOf('no-es-fecha')).toBe('')
  })
  it('todayChile tiene forma YYYY-MM-DD', () => {
    expect(todayChile()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('monthRange', () => {
  it('mes anterior con su nombre', () => {
    expect(monthRange('2026-11-15', 1)).toMatchObject({ from: '2026-10-01', to: '2026-10-31', name: 'octubre de 2026' })
  })
  it('atrás de enero cruza el año', () => {
    expect(monthRange('2026-01-20', 1)).toMatchObject({ from: '2025-12-01', to: '2025-12-31' })
  })
})
