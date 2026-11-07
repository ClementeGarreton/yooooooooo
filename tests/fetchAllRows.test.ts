import { describe, expect, it } from 'vitest'
import { fetchAllRows } from '@/lib/server/fetchAllRows'

type Fila = { id: number }

/** Finge una tabla de `total` filas servida por rangos, y anota cada rango pedido. */
function fakeTabla(total: number, failOnFrom?: number) {
  const rangos: Array<[number, number]> = []
  const page = async (from: number, to: number) => {
    rangos.push([from, to])
    if (failOnFrom === from) return { data: null as Fila[] | null, error: { message: `boom ${from}` } }
    const data: Fila[] = []
    for (let id = from; id <= to && id < total; id++) data.push({ id })
    return { data, error: null }
  }
  return { rangos, page }
}

describe('fetchAllRows', () => {
  it('trae todas las filas, en orden, cuando no llenan la última página', async () => {
    const t = fakeTabla(2500)
    const { data, error } = await fetchAllRows<Fila>(t.page)
    expect(error).toBeNull()
    expect(data).toHaveLength(2500)
    expect(data.map((r) => r.id)).toEqual(Array.from({ length: 2500 }, (_, i) => i))
    // La segunda ola pide de a 2: la página [3000,3999] vuelve vacía junto con la última llena.
    expect(t.rangos).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
      [3000, 3999],
    ])
  })

  it('cuando las filas llenan las páginas justas, cierra con la vuelta vacía', async () => {
    const t = fakeTabla(2000)
    const { data, error } = await fetchAllRows<Fila>(t.page)
    expect(error).toBeNull()
    expect(data).toHaveLength(2000)
    expect(t.rangos).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
      [3000, 3999],
    ])
  })

  it('tabla vacía devuelve vacío sin loop infinito', async () => {
    const t = fakeTabla(0)
    const { data, error } = await fetchAllRows<Fila>(t.page)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('un error a mitad corta la lectura y devuelve lo acumulado con el error', async () => {
    const t = fakeTabla(2500, 1000)
    const { data, error } = await fetchAllRows<Fila>(t.page)
    expect(error).not.toBeNull()
    expect(data).toHaveLength(1000)
    expect(t.rangos.length).toBeLessThanOrEqual(2)
  })

  it('error en la primera página no devuelve filas', async () => {
    const t = fakeTabla(2500, 0)
    const { data, error } = await fetchAllRows<Fila>(t.page)
    expect(error).not.toBeNull()
    expect(data).toEqual([])
  })
})
