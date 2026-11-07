/**
 * Lee TODAS las filas de una consulta de Supabase, de a páginas.
 *
 * PostgREST corta cada respuesta en 1.000 filas (el `max-rows` del proyecto) sin avisar:
 * la consulta no falla, simplemente devuelve menos. Así fue como el panel de Prospectos
 * dejó de mostrar los leads más antiguos cuando la tabla pasó de 1.000 filas (medido el
 * 15-sep-2026: 931 de 1.021 visibles).
 *
 * `page(from, to)` tiene que armar la consulta con un orden ESTABLE (con desempate por
 * `id`); si no, entre una página y la siguiente las filas pueden reordenarse y aparecer
 * repetidas o saltarse.
 *
 * Las páginas se piden de a `concurrency` a la vez: con 1.099 prospectos eran dos viajes
 * seguidos a la base y ahora es uno. El costo es, a lo más, una consulta de más que vuelve
 * vacía cuando las filas justo llenan las páginas.
 */
export async function fetchAllRows<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>,
  pageSize = 1000,
  concurrency = 2
): Promise<{ data: T[]; error: any }> {
  const rows: T[] = []
  for (let first = 0; ; first += concurrency) {
    const wave = await Promise.all(
      Array.from({ length: concurrency }, (_, i) => {
        const from = (first + i) * pageSize
        return page(from, from + pageSize - 1)
      })
    )
    // En orden: la primera página corta (o con error) cierra la lectura.
    for (const { data, error } of wave) {
      if (error) return { data: rows, error }
      const batch = data || []
      rows.push(...batch)
      if (batch.length < pageSize) return { data: rows, error: null }
    }
  }
}
