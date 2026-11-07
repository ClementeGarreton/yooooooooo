'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ClipboardList, Plus, RefreshCw, Search, Trash2 } from 'lucide-react'

type Booking = {
  id: string
  quote_id?: string | null
  client_name?: string | null
  client_phone?: string | null
  scheduled_date?: string | null
  scheduled_time?: string | null
  status?: string | null
  total_price?: number | null
  origin_address?: string | null
  destination_address?: string | null
  duration_hours?: number | null
  total_volume?: number | null
  recommended_vehicle?: string | null
  is_provisional?: boolean | null
}
type Props = { onOpen: (booking: { quote_id?: string | null; client_name?: string | null }) => void }
type Period = 'today' | 'tomorrow' | 'week' | 'month' | 'range' | 'all'
type View = 'upcoming' | 'history' | 'tasks'
type LocalTask = { id: string; title: string; done: boolean }
const chileToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const shiftDays = (date: string, days: number) => { const [y, m, d] = date.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10) }
const dateInLocalMonth = (date: string) => date.slice(0, 7)
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
  const [tasks, setTasks] = useState<LocalTask[]>([])
  const [taskTitle, setTaskTitle] = useState('')
  const [loadedTasks, setLoadedTasks] = useState(false)

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
  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem('ym-admin-tareas-locales-v3') || '[]') as unknown
      if (Array.isArray(saved)) setTasks(saved.filter(v => v && typeof v === 'object' && 'title' in v).slice(0, 100) as LocalTask[])
    } catch { /* Sin tareas locales guardadas */ }
    setLoadedTasks(true)
  }, [])
  useEffect(() => {
    if (loadedTasks) { try { window.localStorage.setItem('ym-admin-tareas-locales-v3', JSON.stringify(tasks)) } catch { /* Almacenamiento deshabilitado */ } }
  }, [tasks, loadedTasks])

  const today = chileToday()
  const filtered = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase('es')
    const month = dateInLocalMonth(today)
    return bookings.filter(booking => {
      const day = booking.scheduled_date || ''
      if (!day || booking.status === 'cancelled' || booking.is_provisional === true) return false
      if (view === 'history' && day >= today) return false
      if (view !== 'history' && day < today) return false
      if (period === 'today' && day !== today) return false
      if (period === 'tomorrow' && day !== shiftDays(today, 1)) return false
      if (period === 'week' && (view === 'history' ? day < shiftDays(today, -7) : (day < today || day > shiftDays(today, 6)))) return false
      if (period === 'month' && dateInLocalMonth(day) !== month) return false
      if (period === 'range' && (day < from || day > to)) return false
      return `${booking.client_name || ''} ${booking.client_phone || ''} ${booking.quote_id || ''} ${booking.origin_address || ''} ${booking.destination_address || ''}`.toLocaleLowerCase('es').includes(needle)
    }).sort((a, b) => {
      const first = `${a.scheduled_date} ${a.scheduled_time || ''}`
      const second = `${b.scheduled_date} ${b.scheduled_time || ''}`
      return view === 'history' ? second.localeCompare(first) : first.localeCompare(second)
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
  const switchView = (selected: View) => {
    setView(selected)
    setPeriod(selected === 'history' ? 'all' : 'month')
  }
  const addTask = () => {
    const title = taskTitle.trim()
    if (!title) return
    setTasks(prev => [{ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, title, done: false }, ...prev].slice(0, 100))
    setTaskTitle('')
  }

  return <div className="admin-jobs-view">
    <div className="admin-jobs-top">
      <div><h2>Trabajos</h2><p>Camión y cuadrilla de cada servicio. Abre una reserva para consultar sus datos.</p></div>
      <div className="admin-jobs-views" role="tablist" aria-label="Vistas de trabajos">
        <button type="button" role="tab" aria-selected={view === 'upcoming'} className={view === 'upcoming' ? 'active' : ''} onClick={() => switchView('upcoming')}>Por asignar</button>
        <button type="button" role="tab" aria-selected={view === 'history'} className={view === 'history' ? 'active' : ''} onClick={() => switchView('history')}>Historial</button>
        <button type="button" role="tab" aria-selected={view === 'tasks'} className={view === 'tasks' ? 'active' : ''} onClick={() => switchView('tasks')}>Tareas</button>
      </div>
    </div>
    {view === 'tasks' ? <div className="admin-recovered-card">
      <div className="admin-recovered-card-head"><h3>Tareas</h3><span className="admin-recovered-pill">Sólo en este navegador</span></div>
      <div className="admin-recovered-notice"><ClipboardList size={19}/><div><strong>Lista de apoyo local</strong><p>Las tareas se conservan solamente en este Chrome. No aparecen en el panel de trabajadores ni se sincronizan con otras cuentas o dispositivos.</p></div></div>
      <form className="admin-task-form" onSubmit={e => { e.preventDefault(); addTask() }}><input aria-label="Nueva tarea" value={taskTitle} onChange={e=>setTaskTitle(e.target.value)} placeholder="Escribir una tarea…" maxLength={220}/><button type="submit" disabled={!taskTitle.trim()}><Plus size={16}/> Agregar tarea</button></form>
      {tasks.length === 0 ? <p className="admin-jobs-empty">Sin tareas locales. Agrega una si quieres dejar una anotación de trabajo en este navegador.</p> : tasks.map(task=><div className="admin-local-task" key={task.id}><label><input type="checkbox" checked={task.done} onChange={e=>setTasks(prev=>prev.map(t=>t.id===task.id ? {...t,done:e.target.checked}:t))}/><span className={task.done ? 'done' : ''}>{task.title}</span></label><button type="button" aria-label="Eliminar tarea" onClick={()=>setTasks(prev=>prev.filter(t=>t.id!==task.id))}><Trash2 size={16}/></button></div>)}
    </div> : <>
      <div className="admin-jobs-filters">
        <div className="admin-range-tabs" role="group" aria-label="Periodo">{(
          view==='upcoming'
          ? [['today', 'Hoy'], ['tomorrow', 'Mañana'], ['week', 'Semana'], ['month', 'Mes'], ['range', 'Rango']]
          : [['all', 'Todo'], ['week', 'Semana'], ['month', 'Mes'], ['range', 'Rango']]
        ).map(([key, label]) => <button key={key} type="button" onClick={() => setPeriod(key as Period)} className={period === key ? 'is-active' : ''} aria-pressed={period === key}>{label}</button>)}</div>
        {period === 'range' && <div className="admin-jobs-dates"><label>Desde <input aria-label="Desde" type="date" value={from} onChange={e => setFrom(e.target.value)} /></label><label>Hasta <input aria-label="Hasta" type="date" value={to} onChange={e => setTo(e.target.value)} /></label></div>}
        <label className="admin-jobs-search"><Search size={15} /><input type="search" aria-label="Buscar trabajo" placeholder="Cliente o cotización" value={search} onChange={e => setSearch(e.target.value)} /></label>
        <button className="admin-jobs-reload" type="button" onClick={() => void load()} disabled={loading}><RefreshCw size={14}/>{loading ? 'Actualizando…' : 'Actualizar'}</button>
      </div>
      <div className="admin-jobs-counter">{filtered.length} {filtered.length === 1 ? 'trabajo' : 'trabajos'} {view === 'upcoming' ? 'programados' : 'en el historial'}. La API actual no contiene las asignaciones de camión o cuadrilla.</div>
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
    </>}
  </div>
}
