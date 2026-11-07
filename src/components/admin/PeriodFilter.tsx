'use client'

import { PERIOD_LABELS, type Period, type PeriodPreset } from '@/lib/period'

/**
 * Filtro de fecha del panel: el mismo control, con las mismas reglas, en todas las pantallas
 * que listan registros. Va arriba a la derecha, al lado del título.
 *
 * `presets` decide qué opciones ofrece cada pantalla (por ejemplo, «Mañana» no tiene sentido
 * en un registro de actividad), pero el aspecto y el significado de cada una no cambian.
 */
export default function PeriodFilter({
  value,
  onChange,
  presets = ['day', 'week', 'month', 'custom'],
  className = '',
}: {
  value: Period
  onChange: (next: Period) => void
  presets?: PeriodPreset[]
  className?: string
}) {
  return (
    <div className={`flex flex-wrap items-center justify-end gap-2 ${className}`}>
      <div className="flex gap-1 rounded-xl bg-gray-100 p-1 text-sm" role="group" aria-label="Filtrar por fecha">
        {presets.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => onChange({ ...value, preset: id })}
            aria-pressed={value.preset === id}
            className={`rounded-lg px-3 py-1.5 font-semibold ${
              value.preset === id ? 'bg-white text-primary-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            {PERIOD_LABELS[id]}
          </button>
        ))}
      </div>
      {value.preset === 'custom' && (
        <div className="flex items-center gap-1 text-sm text-gray-600">
          <input
            type="date"
            value={value.from}
            onChange={(e) => onChange({ ...value, from: e.target.value })}
            aria-label="Desde"
            className="rounded-lg border border-gray-300 px-2 py-1.5"
          />
          <span>al</span>
          <input
            type="date"
            value={value.to}
            min={value.from || undefined}
            onChange={(e) => onChange({ ...value, to: e.target.value })}
            aria-label="Hasta"
            className="rounded-lg border border-gray-300 px-2 py-1.5"
          />
        </div>
      )}
    </div>
  )
}
