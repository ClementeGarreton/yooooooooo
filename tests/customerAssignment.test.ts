import { describe, expect, it, vi } from 'vitest'

// El módulo importa supabaseAdmin arriba: sin credenciales el import revienta, y este
// test solo prueba la parte pura. Mock vacío y listo.
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))

import { resolveCustomerAssignment } from '@/lib/customerAssignment'

// El resolver del bloque «Camión asignado» del Panel del Cliente (patente y chofer,
// pedido de Tomás del 06-11-2026). Todo entra por parámetro: sin base de datos.
const FLOTA = [
  { id: 1, name: 'Camión 1', driver: 'Pedro Suárez' },
  { id: 2, name: 'Camión Grande', driver: '' },
  { id: 3, name: '  ', driver: 'Luis Peña' },
]

describe('resolveCustomerAssignment', () => {
  it('sin camión asignado no hay bloque', () => {
    expect(resolveCustomerAssignment({ vehicleId: null, vehicles: FLOTA, crewChofers: [] })).toBeNull()
    expect(resolveCustomerAssignment({ vehicleId: undefined, vehicles: FLOTA, crewChofers: [] })).toBeNull()
  })

  it('nombre + patente + chofer designado en Flota', () => {
    expect(
      resolveCustomerAssignment({ vehicleId: 1, vehicles: FLOTA, plate: 'ab·cd·12', crewChofers: [] })
    ).toEqual({ vehicleName: 'Camión 1', plate: 'AB·CD·12', driver: 'Pedro Suárez' })
  })

  it('el chofer de la cuadrilla manda sobre el designado en Flota', () => {
    const r = resolveCustomerAssignment({
      vehicleId: 1,
      vehicles: FLOTA,
      crewChofers: [{ name: 'Ana Rivas' }],
    })
    expect(r?.driver).toBe('Ana Rivas')
  })

  it('varios choferes en la cuadrilla → orden estable por nombre', () => {
    const r = resolveCustomerAssignment({
      vehicleId: 1,
      vehicles: FLOTA,
      crewChofers: [{ name: 'Zalo M.' }, { name: 'Ana Rivas' }, { name: '' }],
    })
    expect(r?.driver).toBe('Ana Rivas')
  })

  it('sin chofer en ningún lado y sin patente: solo el camión', () => {
    expect(
      resolveCustomerAssignment({ vehicleId: 2, vehicles: FLOTA, plate: null, crewChofers: [{ name: '   ' }] })
    ).toEqual({ vehicleName: 'Camión Grande', plate: null, driver: null })
  })

  it('camión sin nombre o fuera de la flota conserva la etiqueta vieja «Camión N»', () => {
    expect(resolveCustomerAssignment({ vehicleId: 3, vehicles: FLOTA, crewChofers: [] })?.vehicleName).toBe('Camión 3')
    expect(resolveCustomerAssignment({ vehicleId: 9, vehicles: FLOTA, crewChofers: [] })?.vehicleName).toBe('Camión 9')
  })
})
