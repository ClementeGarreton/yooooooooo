'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react'

type Booking = {
  id: string
  quote_id?: string | null
  client_name?: string | null
  scheduled_date?: string | null
  scheduled_time?: string | null
  status?: string | null
  is_provisional?: boolean | null
  booking_type?: string | null
}

type Props = {
  onOpen: (booking: { quote_id?: string | null; client_name?: string | null }) => void
}

const chileToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const monthLabel = (year: number, month: number) => new Intl.DateTimeFormat('es-CL', { year: 'numeric', month: 'long' }).format(new Date(year, month, 1))
const validDate = (date?: string | null): date is string => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)
const localDate = (year: number, month: number, day: number) => `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
const getEventColor = (status?: string | null) => {
  if (status === 'cancelled' || status === 'no_show') return 'admin-calendar-event is-cancelled'
  if (status === 'pending') return 'admin-calendar-event is-pending'
  if (status === 'completed') return 'admin-calendar-event is-completed'
  return 'admin-calendar-event is-confirmed'
}

export default function CalendarioMensual({ onOpen }: Props) {
  const today = chileToday()
  const [year, setYear] = useState(Number(today.slice(0, 4)))
  const [month, setMonth] = useState(Number(today.slice(5, 7)) - 1)
  const [bookings, setBookings] = useState<Booking[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expandedDays, setExpandedDays] = useState<string[]>([])

  const reload = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/admin/bookings', { cache: 'no-store' })
      if (!response.ok) throw new Error(`Error HTTP ${response.status}`)
      const data: unknown = await response.json()
      if (!Array.isArray(data)) throw new Error('La API devolvió datos inesperados')
      setBookings(data as Booking[])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron cargar las reservas')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void reload() }, [reload])

  const byDate = useMemo(() => {
    const grouped = new Map<string, Booking[]>()
    for (const booking of bookings) {
      if (!validDate(booking.scheduled_date)) continue
      const current = grouped.get(booking.scheduled_date) || []
      current.push(booking)
      grouped.set(booking.scheduled_date, current)
    }
    for (const list of grouped.values()) list.sort((a, b) => (a.scheduled_time || '').localeCompare(b.scheduled_time || ''))
    return grouped
  }, [bookings])

  const days = useMemo(() => {
    const first = new Date(year, month, 1)
    const offset = (first.getDay() + 6) % 7
    const count = Math.ceil((offset + new Date(year, month + 1, 0).getDate()) / 7) * 7
    return Array.from({ length: count }, (_, index) => {
      const date = new Date(year, month, 1 - offset + index)
      return { key: localDate(date.getFullYear(), date.getMonth(), date.getDate()), day: date.getDate(), inMonth: date.getMonth() === month }
    })
  }, [year, month])

  const changeMonth = (delta: number) => {
    const date = new Date(year, month + delta, 1)
    setYear(date.getFullYear())
    setMonth(date.getMonth())
    setExpandedDays([])
  }

  return (
    <div className="admin-calendar-month">
      <div className="admin-calendar-toolbar">
        <div className="admin-calendar-month-controls">
          <button type="button" onClick={() => changeMonth(-1)} aria-label="Mes anterior"><ChevronLeft size={20}/></button>
          <h2 className="capitalize">{monthLabel(year, month)}</h2>
          <button type="button" onClick={() => changeMonth(1)} aria-label="Mes siguiente"><ChevronRight size={20}/></button>
          <button type="button" className="admin-calendar-today" onClick={() => { setYear(Number(today.slice(0, 4))); setMonth(Number(today.slice(5, 7)) - 1) }}>Hoy</button>
        </div>
        <div className="admin-calendar-legend"><span><i className="dot is-confirmed"/> Confirmadas</span><span><i className="dot is-pending"/> Pendientes</span><span><i className="dot is-completed"/> Completadas</span><button type="button" onClick={() => void reload()} disabled={loading}><RefreshCw size={14}/>{loading ? 'Cargando…' : 'Actualizar'}</button></div>
      </div>
      {error && <p role="alert" className="admin-calendar-error">No se pudo consultar el calendario: {error}. No se están mostrando reservas inventadas.</p>}
      <div className="admin-calendar-grid" aria-label={`Calendario de ${monthLabel(year, month)}`}>
        {['LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB', 'DOM'].map(label => <div className="admin-calendar-dow" key={label}>{label}</div>)}
        {days.map(date => {
          const bookingsForDay = byDate.get(date.key) || []
          const expanded = expandedDays.includes(date.key)
          return <div key={date.key} className={`admin-calendar-cell ${date.inMonth ? '' : 'is-other-month'} ${date.key === today ? 'is-today' : ''}`}>
            <div className="admin-calendar-cell-heading"><span>{date.day}</span>{bookingsForDay.length > 0 && <span className="admin-calendar-count">{bookingsForDay.length}</span>}</div>
            {(expanded ? bookingsForDay : bookingsForDay.slice(0, 3)).map(booking => (
              <button type="button" key={booking.id} className={getEventColor(booking.status)} title={`${booking.client_name || 'Reserva'} · ${booking.quote_id || ''}`} onClick={() => onOpen(booking)}>
                {booking.scheduled_time?.slice(0, 5)} {booking.client_name || booking.quote_id || 'Sin nombre'}
              </button>
            ))}
            {bookingsForDay.length > 3 && <button type="button" className="admin-calendar-expand" onClick={() => setExpandedDays(prev => expanded ? prev.filter(day => day !== date.key) : [...prev, date.key])}>{expanded ? 'Ver menos' : `+${bookingsForDay.length - 3} más`}</button>}
          </div>
        })}
      </div>
      {!loading && !error && <p className="admin-calendar-note">{bookings.length} reservas consultadas desde la API actual. Pulsa una para abrir su gestión.</p>}
    </div>
  )
}
