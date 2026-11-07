'use client'

import { useEffect, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import { SEARCH_KIND_LABEL, type SearchHit, type SearchKind, type SearchResults } from '@/lib/adminSearchTypes'

/**
 * Buscador general del panel, en la barra lateral: reservas y trabajos (ID, cliente,
 * teléfono, dirección, N° de OD o guía), cotizaciones, clientes, empresas, trabajadores,
 * gastos y facturas. Los resultados se abren en una ventana flotante (la barra lateral es
 * angosta); elegir uno lleva a su pestaña, y una reserva se abre ya buscada en Reservas.
 */

const ORDER: SearchKind[] = ['booking', 'prospect', 'customer', 'company', 'worker', 'expense', 'worker_expense', 'invoice']

export default function GlobalSearch({ onPick }: { onPick: (hit: SearchHit) => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResults | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  // Busca 300 ms después de la última tecla; descarta respuestas de búsquedas anteriores.
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setResults(null)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/admin/search?q=${encodeURIComponent(q)}`)
        const body = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(body?.error || 'No se pudo buscar')
        if (!cancelled) {
          setResults(body)
          setError(null)
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'No se pudo buscar')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query])

  // Cerrar al hacer clic fuera o con Escape.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (!boxRef.current?.contains(target) && !panelRef.current?.contains(target)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const pick = (hit: SearchHit) => {
    setOpen(false)
    onPick(hit)
  }

  const showPanel = open && query.trim().length >= 2
  const groups = ORDER.map((kind) => ({ kind, hits: (results?.hits || []).filter((h) => h.kind === kind) })).filter((g) => g.hits.length > 0)

  return (
    <>
      <div ref={boxRef} className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          placeholder="Buscar en todo el panel"
          aria-label="Buscar en todo el panel"
          className="w-full rounded-xl border border-[#2A5A85] bg-[#24486F] py-2 pl-9 pr-8 text-sm text-white placeholder:text-slate-400 focus:border-slate-300 focus:outline-none"
        />
        {query && (
          <button
            type="button"
            onClick={() => {
              setQuery('')
              setOpen(false)
            }}
            aria-label="Limpiar búsqueda"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-300 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {showPanel && (
        <div
          ref={panelRef}
          className="fixed inset-x-2 top-28 z-50 max-h-[75vh] overflow-y-auto rounded-2xl border border-gray-200 bg-white text-gray-900 shadow-2xl lg:left-[17rem] lg:right-auto lg:top-6 lg:w-[34rem]"
        >
          <div className="sticky top-0 border-b border-gray-100 bg-white px-4 py-2 text-xs text-gray-500">
            {loading ? 'Buscando…' : error ? <span className="text-red-700">{error}</span> : `Resultados para «${results?.query || query.trim()}»`}
          </div>
          {!loading && !error && results && groups.length === 0 && <p className="px-4 py-6 text-sm text-gray-500">No encontramos nada con eso.</p>}
          {groups.map((g) => (
            <div key={g.kind} className="border-b border-gray-100 last:border-b-0">
              <p className="px-4 pb-1 pt-3 text-[11px] font-bold uppercase tracking-wider text-gray-500">{SEARCH_KIND_LABEL[g.kind]}</p>
              <ul>
                {g.hits.map((hit) => (
                  <li key={`${hit.kind}-${hit.id}`}>
                    <button type="button" onClick={() => pick(hit)} className="block w-full px-4 py-2 text-left hover:bg-gray-50">
                      <span className="block truncate text-sm font-semibold text-gray-900">{hit.title}</span>
                      {hit.detail && <span className="block truncate text-xs text-gray-500">{hit.detail}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
