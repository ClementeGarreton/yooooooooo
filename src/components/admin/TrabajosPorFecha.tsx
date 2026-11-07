'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCw, Search } from 'lucide-react'

type Booking = {
  id: string
  quote_id?: string | null
  client_name?: string | null
  client_phone?: string | null
  scheduled_date?: string | null
  scheduled_time?: string | null
  status?: string | null
  total_price?: number | null
  original_price?: number | null
  origin_address?: string | null
  destination_address?: string | null
  duration_hours?: number | null
  total_volume?: number | null
  recommended_vehicle?: string | null
  booking_type?: string | null
  is_provisional?: boolean | null
}
type Props = { onOpen: (booking: { quote_id?: string | null; client_name?: string | null }) => void }
type Period = 'today' | 'tomorrow' | 'week' | 'month' | 'range'
type View = 'upcoming' | 'history'
const chileToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const shiftDays = (date: string, days: number) => { const [y, m, d] = date.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10) }
const displayDate = (date: string) => { const [y, m, d] = date.split('-').map(Number); return new Intl.DateTimeFormat('es-CL', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(y, m - 1, d)) }
const statusLabel: Record<string, string> = { pending: 'Pendiente', confirmed: 'Confirmada', completed: 'Finalizada', cancelled: 'Cancelada', no_show: 'No asistió' }

export default function TrabajosPorFecha({ onOpen }: Props) {
  const [bookings, setBookings] = useState<Booking[]>([])
  const [period, setPeriod] = useState<Period>('month')
  const [view, setView] = useState<View>('upcoming')
  const [from, setFrom] = useState(chileToday())
  const [to, setTo] = useState(shiftDays(chileToday(), 13))
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/admin/bookings', { cache: 'no-store' })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data: unknown = await response.json()
      if (!Array.isArray(data)) throw new Error('La API devolvió datos inesperados')
      setBookings(data as Booking[])
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudieron consultar los trabajos') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  const today = chileToday()
  const filtered = useMemo(() => {
    const active = view === 'upcoming'
    let start = today, end = shiftDays(today, 6)
    if (period === 'today') end = start
    if (period === 'tomorrow') { start = shiftDays(today, 1); end = start }
    if (period === 'month') end = shiftDays(today, 29)
    if (period === 'range') { start = from; end = to }
    if (!active) { start = '1900-01-01'; end = shiftDays(today, -1) }
    const needle = search.trim().toLocaleLowerCase('es')
    return bookings.filter(booking =>
      Boolean(booking.scheduled_date && booking.scheduled_date >= start && booking.scheduled_date <= end) &&
      booking.status !== 'cancelled' && booking.is_provisional !== true &&
      `${booking.client_name || ''} ${booking.client_phone || ''} ${booking.quote_id || ''} ${booking.origin_address || ''} ${booking.destination_address || ''}`.toLocaleLowerCase('es').includes(needle)
    ).sort((a, b) => {
      const first = `${a.scheduled_date} ${a.scheduled_time || ''}`
      const second = `${b.scheduled_date} ${b.scheduled_time || ''}`
      return active ? first.localeCompare(second) : second.localeCompare(first)
    })
  }, [bookings, period, from, to, search, today, view])
  const groups = useMemo(() => {
    const out = new Map<string, Booking[]>()
    for (const booking of filtered) {
      const date = booking.scheduled_date || ''
      out.set(date, [...(out.get(date) || []), booking])
    }
    return [...out]
  }, [filtered])

  return <div className="admin-jobs-view">
    <div className="admin-jobs-top">
      <div><h2>Trabajos</h2><p>Ordenados por fecha y hora. Abre uno para gestionar su reserva.</p></div>
      <div className="admin-jobs-views" role="group" aria-label="Tipo de trabajos">
        <button type="button" className={view === 'upcoming' ? 'active' : ''} onClick={() => setView('upcoming')}>Programados</button>
        <button type="button" className={view === 'history' ? 'active' : ''} onClick={() => setView('history')}>Historial</button>
        <button type="button" disabled title="No hay una API de tareas de equipo en este proyecto">Tareas</button>
      </div>
    </div>
    <div className="admin-jobs-filters">
      {view === 'upcoming' && <div className="admin-range-tabs" role="group" aria-label="Periodo">{([['today', 'Hoy'], ['tomorrow', 'Mañana'], ['week', 'Semana'], ['month', 'Mes'], ['range', 'Rango']] as const).map(([key, label]) => <button key={key} type="button" onClick={() => setPeriod(key)} className={period === key ? 'is-active' : ''} aria-pressed={period === key}>{label}</button>)}</div>}
      {view === 'upcoming' && period === 'range' && <div className="admin-jobs-dates"><label>Desde <input aria-label="Desde" type="date" value={from} onChange={e => setFrom(e.target.value)} /></label><label>Hasta <input aria-label="Hasta" type="date" value={to} onChange={e => setTo(e.target.value)} /></label></div>}
      <label className="admin-jobs-search"><Search size={15} /><input type="search" aria-label="Buscar trabajo" placeholder="Cliente o cotización" value={search} onChange={e => setSearch(e.target.value)} /></label>
      <button className="admin-jobs-reload" type="button" onClick={() => void load()} disabled={loading}><RefreshCw size={14} /> {loading ? 'Actualizando…' : 'Actualizar'}</button>
    </div>
    <div className="admin-jobs-counter">{filtered.length} {filtered.length === 1 ? 'trabajo' : 'trabajos'} {view === 'upcoming' ? 'programados' : 'en el historial'}. La asignación de camiones/cuadrillas no está disponible en esta API.</div>
    {error && <p role="alert" className="admin-calendar-error">No se pudieron consultar los trabajos: {error}</p>}
    {loading ? <p className="admin-jobs-empty">Cargando trabajos…</p> : !error && groups.length === 0 ? <p className="admin-jobs-empty">No hay trabajos para este período.</p> : groups.map(([date, rows]) =>
      <section className="admin-jobs-day" key={date}>
        <h3>{displayDate(date)} <span>({rows.length})</span></h3>
        {rows.map(booking => <button type="button" className="admin-jobs-booking" key={booking.id} onClick={() => onOpen(booking)}>
          <span className="admin-jobs-time">{booking.scheduled_time?.slice(0, 5) || '--:--'}</span>
          <span className="admin-jobs-details"><strong>{booking.client_name || 'Sin nombre'} <span>· {booking.quote_id || ''}</span></strong>
            <span>{[booking.origin_address, booking.destination_address].filter(Boolean).join(' → ') || 'Direcciones disponibles en su ficha'}</span>
            <small>{booking.total_volume != null ? `${Number(booking.total_volume).toLocaleString('es-CL')} m³ · ` : ''}{booking.duration_hours ? `${booking.duration_hours} horas · ` : ''}{booking.client_phone || ''}</small>
          </span>
          {booking.recommended_vehicle && <span className="admin-jobs-vehicle" title="Vehículo recomendado, no asignado">{booking.recommended_vehicle}</span>}
          <span className={`admin-jobs-status ${booking.status || 'unknown'}`}>{statusLabel[booking.status || ''] || booking.status || 'Sin estado'}</span>
        </button>)}
      </section>
    )}
  </div>
}
