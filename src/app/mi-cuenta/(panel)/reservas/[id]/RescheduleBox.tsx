'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatLongDate } from '../../../format'

type Reason = 'status' | 'domicilio' | 'too_close' | 'no_schedule' | null

interface DateOption {
  date: string
  allowed: boolean
}

interface SlotOption {
  time: string
  label: string
  available: boolean
}

const WEEK = ['LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB', 'DOM']
const MONTHS = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]

/** Celdas de un mes 'YYYY-MM' con lunes como primer día; null = hueco antes del día 1. */
function monthCells(month: string): (string | null)[] {
  const [y, m] = month.split('-').map(Number)
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay() // 0 = domingo
  const lead = (first + 6) % 7
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const cells: (string | null)[] = Array(lead).fill(null)
  for (let d = 1; d <= days; d++) cells.push(`${month}-${String(d).padStart(2, '0')}`)
  return cells
}

/**
 * Reprogramar una reserva (Módulo 1, paso 4). Las reglas las aplica el servidor; esto solo
 * las muestra: días con más recargo deshabilitados, horarios sin cupo o con menos de 48
 * horas deshabilitados, y el mensaje de WhatsApp cuando ya no se puede cambiar solo.
 */
/** `noun` = «mudanza» o «trabajo» (persona de una empresa), ver serviceWords. */
export default function RescheduleBox({ bookingId, reason, noun = 'mudanza' }: { bookingId: string; reason: Reason; noun?: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [dates, setDates] = useState<DateOption[]>([])
  const [month, setMonth] = useState('')
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [slots, setSlots] = useState<SlotOption[] | null>(null)
  const [selectedTime, setSelectedTime] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<string | null>(null)

  const byDate = useMemo(() => new Map(dates.map((d) => [d.date, d])), [dates])
  const months = useMemo(() => Array.from(new Set(dates.map((d) => d.date.slice(0, 7)))), [dates])

  if (reason === 'too_close') {
    return (
      <div className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800">
        Faltan 48 horas o menos para tu {noun}. Para cambiar la fecha, escríbenos por WhatsApp.
      </div>
    )
  }
  if (reason) return null

  async function start() {
    setOpen(true)
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/cuenta/reservas/${bookingId}/reprogramar`)
      const body = await res.json().catch(() => ({}))
      if (!res.ok || !body?.canReschedule) {
        setError(
          body?.reason === 'too_close'
            ? `Faltan 48 horas o menos para tu ${noun}. Para cambiar la fecha, escríbenos por WhatsApp.`
            : body?.error || 'Esta reserva no se puede reprogramar desde aquí.'
        )
        return
      }
      setDates(body.dates || [])
      setMonth((body.dates?.[0]?.date || '').slice(0, 7))
    } catch {
      setError('No pudimos cargar la disponibilidad. Intenta de nuevo.')
    } finally {
      setLoading(false)
    }
  }

  async function pickDate(date: string) {
    setSelectedDate(date)
    setSelectedTime(null)
    setSlots(null)
    setError('')
    try {
      const res = await fetch(`/api/cuenta/reservas/${bookingId}/reprogramar?date=${date}`)
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error)
      setSlots(body.slots || [])
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : 'No pudimos cargar los horarios.')
    }
  }

  async function confirm() {
    if (!selectedDate || !selectedTime) return
    setSaving(true)
    setError('')
    try {
      const res = await fetch(`/api/cuenta/reservas/${bookingId}/reprogramar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: selectedDate, time: selectedTime }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body?.error || 'No pudimos cambiar la fecha. Intenta de nuevo.')
        // Si el horario se ocupó mientras elegía, se refrescan los horarios del día.
        if (res.status === 409 && selectedDate) pickDate(selectedDate)
        return
      }
      setDone(`${formatLongDate(body.date)} · ${body.time}`)
      setOpen(false)
      router.refresh()
    } catch {
      setError('No pudimos conectarnos. Revisa tu conexión e intenta de nuevo.')
    } finally {
      setSaving(false)
    }
  }

  if (done) {
    return (
      <div className="rounded-xl bg-lime-50 p-4 text-sm text-lime-800">
        Listo: tu {noun} quedó para el <strong>{done}</strong>.
      </div>
    )
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={start}
        className="rounded-lg border-2 border-slate-200 px-4 py-2 text-sm font-bold text-brand-blue-dark hover:border-brand-blue"
      >
        Cambiar fecha
      </button>
    )
  }

  const monthIndex = months.indexOf(month)
  const [y, m] = month ? month.split('-').map(Number) : [0, 0]

  return (
    <div className="space-y-4 rounded-xl bg-slate-50 p-4">
      {loading && <p className="text-sm text-slate-500">Cargando disponibilidad…</p>}

      {!loading && dates.length > 0 && (
        <>
          <div>
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-slate-900">1. Elige una nueva fecha</h3>
              <div className="flex items-center gap-2 text-sm">
                <button
                  type="button"
                  disabled={monthIndex <= 0}
                  onClick={() => setMonth(months[monthIndex - 1])}
                  className="rounded px-2 py-1 font-bold text-slate-600 disabled:opacity-30"
                  aria-label="Mes anterior"
                >
                  ‹
                </button>
                <span className="whitespace-nowrap font-semibold text-slate-700">
                  {MONTHS[m - 1]} {y}
                </span>
                <button
                  type="button"
                  disabled={monthIndex >= months.length - 1}
                  onClick={() => setMonth(months[monthIndex + 1])}
                  className="rounded px-2 py-1 font-bold text-slate-600 disabled:opacity-30"
                  aria-label="Mes siguiente"
                >
                  ›
                </button>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-7 gap-1 text-center">
              {WEEK.map((w) => (
                <span key={w} className="text-[11px] font-bold text-slate-400">
                  {w}
                </span>
              ))}
              {monthCells(month).map((date, i) => {
                if (!date) return <span key={`x${i}`} />
                const option = byDate.get(date)
                const enabled = Boolean(option?.allowed)
                const selected = date === selectedDate
                return (
                  <button
                    key={date}
                    type="button"
                    disabled={!enabled}
                    onClick={() => pickDate(date)}
                    className={`rounded-lg border py-2 text-sm font-semibold ${
                      selected
                        ? 'border-brand-green bg-lime-50 text-lime-800'
                        : enabled
                          ? 'border-slate-200 bg-white text-slate-800 hover:border-brand-blue'
                          : 'border-transparent text-slate-300'
                    }`}
                  >
                    {Number(date.slice(8, 10))}
                  </button>
                )
              })}
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Solo puedes elegir días con el mismo valor que tu reserva. Para otras fechas, escríbenos por WhatsApp.
            </p>
          </div>

          {selectedDate && (
            <div>
              <h3 className="font-bold text-slate-900">2. Elige un horario</h3>
              {slots === null ? (
                <p className="mt-2 text-sm text-slate-500">Cargando horarios…</p>
              ) : slots.filter((s) => s.available).length === 0 ? (
                <p className="mt-2 text-sm text-slate-500">No quedan horarios para ese día. Prueba con otro.</p>
              ) : (
                <div className="mt-2 flex flex-wrap gap-2">
                  {slots.map((s) => (
                    <button
                      key={s.time}
                      type="button"
                      disabled={!s.available}
                      onClick={() => setSelectedTime(s.time.slice(0, 5))}
                      className={`rounded-lg border px-4 py-2 text-sm font-bold ${
                        selectedTime === s.time.slice(0, 5)
                          ? 'border-[#1B3A5C] bg-[#1B3A5C] text-white'
                          : s.available
                            ? 'border-slate-200 bg-white text-slate-800 hover:border-brand-blue'
                            : 'border-transparent bg-slate-100 text-slate-300 line-through'
                      }`}
                    >
                      {s.time.slice(0, 5)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {selectedDate && selectedTime && (
            <div className="rounded-lg bg-white p-4">
              <p className="text-sm text-slate-600">Nueva fecha</p>
              <p className="font-bold text-slate-900">
                {formatLongDate(selectedDate)} · {selectedTime}
              </p>
              <p className="mt-1 text-xs text-slate-500">El valor de tu reserva no cambia. El cupo se valida al confirmar.</p>
              <button
                type="button"
                disabled={saving}
                onClick={confirm}
                className="mt-3 w-full rounded-lg bg-brand-green px-4 py-3 font-bold text-slate-900 hover:bg-brand-green-hover disabled:opacity-60"
              >
                {saving ? 'Confirmando…' : 'Confirmar nueva fecha'}
              </button>
            </div>
          )}
        </>
      )}

      {error && <p className="text-sm font-medium text-red-600">{error}</p>}
      <button
        type="button"
        onClick={() => {
          setOpen(false)
          setError('')
        }}
        className="text-sm font-semibold text-slate-500 hover:text-slate-700"
      >
        Cancelar
      </button>
    </div>
  )
}
