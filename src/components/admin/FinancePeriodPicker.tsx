'use client'

import { monthRange, resolvePeriod, periodOf, todayChile } from '@/lib/period'

export interface FinanceRange {
  from: string
  to: string
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/**
 * El período de todo Finanzas → Resumen (Francisco, 01-11-2026): un botón por mes (el en curso
 * y los dos anteriores), hoy, la semana, y dos fechas para cualquier otro tramo. Copiado de la
 * forma del selector de Finanzas de AppleShop.
 */
export default function FinancePeriodPicker({ value, onChange }: { value: FinanceRange; onChange: (next: FinanceRange) => void }) {
  const today = todayChile()
  const week = resolvePeriod(periodOf('week'), today)
  const presets: { label: string; range: FinanceRange }[] = [
    ...[0, 1, 2].map((back) => {
      const m = monthRange(today, back)
      return { label: capitalize(m.name.split(' ')[0]), range: { from: m.from, to: m.to } }
    }),
    { label: 'Semana', range: { from: week.from as string, to: week.to as string } },
    { label: 'Hoy', range: { from: today, to: today } },
  ]
  const setDate = (key: keyof FinanceRange, day: string) => {
    if (!day) return
    const next = { ...value, [key]: day }
    onChange(next.from <= next.to ? next : { from: next.to, to: next.from })
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <div className="flex flex-wrap gap-1 rounded-xl bg-gray-100 p-1 text-sm" role="group" aria-label="Elegir período">
        {presets.map((p) => {
          const active = p.range.from === value.from && p.range.to === value.to
          return (
            <button
              key={p.label}
              type="button"
              onClick={() => onChange(p.range)}
              aria-pressed={active}
              className={`rounded-lg px-3 py-1.5 font-semibold ${active ? 'bg-white text-primary-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
            >
              {p.label}
            </button>
          )
        })}
      </div>
      <div className="flex items-center gap-1 text-sm text-gray-600">
        <input type="date" value={value.from} onChange={(e) => setDate('from', e.target.value)} aria-label="Desde" className="rounded-lg border border-gray-300 px-2 py-1.5" />
        <span>al</span>
        <input type="date" value={value.to} onChange={(e) => setDate('to', e.target.value)} aria-label="Hasta" className="rounded-lg border border-gray-300 px-2 py-1.5" />
      </div>
    </div>
  )
}
