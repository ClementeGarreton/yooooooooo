'use client'

import { useEffect, useState } from 'react'
import { AlertCircle, CalendarDays, CheckCircle2, Clock3, Mail, RefreshCcw, TrendingUp, Truck, MessageCircle, ExternalLink } from 'lucide-react'

type Stats = {
  todayBookings?: number
  pendingBookings?: number
  occupancyRate?: number
}

type Booking = {
  id: string
  quote_id?: string | null
  client_name?: string | null
  client_phone?: string | null
  client_email?: string | null
  scheduled_date?: string | null
  scheduled_time?: string | null
  status?: string | null
  is_provisional?: boolean | null
  estimated_price?: number | null
  original_price?: number | null
  total_price?: number | null
  origin_address?: string | null
  destination_address?: string | null
  total_volume?: number | null
  recommended_vehicle?: string | null
}

type Props = {
  stats: Stats | null
  todayBookings: Booking[]
  tomorrowBookings: Booking[]
  weekBookings: Booking[]
  onSelect: (tab: string) => void
  onOpen: (booking: { quote_id?: string | null; client_name?: string | null }) => void
  onRefresh: () => void
}

const todayCL = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const dateLabel = (date: string) => {
  const [year, month, day] = date.split('-').map(Number)
  if (!year || !month || !day) return date
  return new Intl.DateTimeFormat('es-CL', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(year, month - 1, day))
}
const money = (value?: number | null) => value == null ? 'Sin precio' : '$' + Number(value).toLocaleString('es-CL')
const statusText: Record<string, string> = { confirmed: 'Confirmada', pending: 'Pendiente', completed: 'Finalizada', cancelled: 'Cancelada', no_show: 'No asistió' }
const statusCss: Record<string, string> = { confirmed: 'confirmed', pending: 'pending', completed: 'completed', cancelled: 'cancelled', no_show: 'cancelled' }
const whatsappHref = (phone: string) => {
  const digits = phone.replace(/\D/g, '')
  if (!digits) return ''
  return 'https://wa.me/' + (digits.startsWith('56') ? digits : digits.length === 9 ? '56' + digits : digits)
}

export default function InicioOperativo({ stats, todayBookings, tomorrowBookings, weekBookings, onSelect, onOpen, onRefresh }: Props) {
  const [period, setPeriod] = useState<'all' | 'today' | 'tomorrow' | 'week' | 'month' | 'range'>('all')
  const [rangeFrom, setRangeFrom] = useState(todayCL())
  const [rangeTo, setRangeTo] = useState(todayCL())
  const [allBookings, setAllBookings] = useState<Booking[]>([])
  const [details, setDetails] = useState<Map<string, Booking>>(new Map())
  const [extraInfoLoaded, setExtraInfoLoaded] = useState(false)

  // Los datos del resumen vienen de /today-bookings. Esta consulta adicional solo
  // complementa las filas con direcciones, volumen y correo si la API ya los entrega.
  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/admin/bookings', { cache: 'no-store', signal: controller.signal })
      .then(res => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json() })
      .then(data => {
        if (!Array.isArray(data)) throw new Error('Formato de reservas inesperado')
        setDetails(new Map<string, Booking>(data.map((booking: Booking) => [booking.id, booking])))
        setAllBookings(data as Booking[])
        setExtraInfoLoaded(true)
      })
      .catch(() => { /* El resumen sigue funcionando con los datos mínimos. */ })
    return () => controller.abort()
  }, [])

  const merged = (rows: Booking[]) => rows.map(booking => ({ ...(details.get(booking.id) || {}), ...booking, // conservar campos enriquecidos cuando la API resumida omite valores
    origin_address: details.get(booking.id)?.origin_address ?? booking.origin_address,
    destination_address: details.get(booking.id)?.destination_address ?? booking.destination_address,
    total_volume: details.get(booking.id)?.total_volume ?? booking.total_volume,
    recommended_vehicle: details.get(booking.id)?.recommended_vehicle ?? booking.recommended_vehicle,
    client_email: details.get(booking.id)?.client_email ?? booking.client_email,
  }))

  const sections = [
    { id: 'today' as const, title: `Reservas de Hoy (${todayCL().split('-').reverse().join('/')})`, rows: merged(todayBookings), empty: 'No hay reservas para hoy' },
    { id: 'tomorrow' as const, title: 'Reservas de Mañana', rows: merged(tomorrowBookings), empty: 'No hay reservas para mañana' },
    { id: 'week' as const, title: 'Esta Semana', rows: merged(weekBookings), empty: 'No hay otras reservas esta semana' },
  ]

  const periodBookings = allBookings.filter(booking => {
    if (!booking.scheduled_date || booking.is_provisional === true || booking.status === 'cancelled') return false
    if (period === 'month') return booking.scheduled_date.slice(0, 7) === todayCL().slice(0, 7)
    if (period === 'range') return Boolean(rangeFrom && rangeTo && rangeFrom <= rangeTo && booking.scheduled_date >= rangeFrom && booking.scheduled_date <= rangeTo)
    return false
  }).sort((a, b) => `${a.scheduled_date} ${a.scheduled_time || ''}`.localeCompare(`${b.scheduled_date} ${b.scheduled_time || ''}`))
  const displayedSections = period === 'month' || period === 'range'
    ? [{ id: 'period' as const, title: period === 'month' ? 'Reservas de este mes' : 'Reservas del rango', rows: periodBookings, empty: 'No hay reservas para el período seleccionado' }]
    : sections.filter(section => period === 'all' || period === section.id)

  const grouped = (rows: Booking[]) => {
    const result = new Map<string, Booking[]>()
    rows.forEach(booking => {
      const key = booking.scheduled_date || ''
      result.set(key, [...(result.get(key) || []), booking])
    })
    return [...result]
  }

  const bookingRow = (booking: Booking) => {
    const price = booking.original_price ?? booking.estimated_price ?? booking.total_price
    const waLink = whatsappHref(booking.client_phone || '')
    const addresses = [booking.origin_address, booking.destination_address].filter(Boolean).join(' → ')
    const label = `${booking.client_name || 'Reserva sin nombre'}: abrir detalles`
    return <div className="admin-home-booking" key={booking.id}>
      <button type="button" className="admin-home-booking-open" onClick={() => onOpen(booking)} aria-label={label}>
        <span className="admin-home-booking-check"><CheckCircle2 size={18} /></span>
        <span className="admin-home-booking-main">
          <strong>{booking.client_name || 'Sin nombre'} <span className="admin-home-quote-id">{booking.quote_id ? `· ${booking.quote_id}` : ''}</span></strong>
          <span className="admin-home-booking-metadata">{booking.client_phone || 'Sin teléfono'} · {booking.scheduled_time?.slice(0, 5) || 'Sin hora'}</span>
          {addresses && <span className="admin-home-booking-address" title={addresses}>{addresses}</span>}
          <span className="admin-home-booking-metadata">
            {booking.total_volume != null && `${Number(booking.total_volume).toLocaleString('es-CL')} m³`}
            {booking.total_volume != null && booking.recommended_vehicle && ' · '}
            {booking.recommended_vehicle ? `Vehículo recomendado: ${booking.recommended_vehicle}` : ''}
          </span>
        </span>
        <span className="admin-home-booking-price">
          <strong>{money(price)}</strong>
          <small className={`admin-home-status ${statusCss[booking.status || ''] || 'unknown'}`}>{statusText[booking.status || ''] || booking.status || 'Sin estado'}</small>
        </span>
      </button>
      <div className="admin-home-booking-actions">
        {waLink && <a href={waLink} target="_blank" rel="noopener noreferrer" aria-label={`WhatsApp de ${booking.client_name}`}><MessageCircle size={12} /> WhatsApp</a>}
        {booking.client_email && <a href={`mailto:${booking.client_email}`} aria-label={`Correo a ${booking.client_name}`}><Mail size={12} /> Email</a>}
        <button type="button" onClick={() => onOpen(booking)}><ExternalLink size={12} /> Ver reserva</button>
      </div>
    </div>
  }

  return <div className="admin-home-view">
    <div className="admin-home-toolbar">
      <div className="admin-home-summary">Lo de hoy y lo pendiente. La ocupación es de este mes.</div>
      <div className="admin-range-tabs" role="group" aria-label="Período de inicio">
        {([['all', 'Todos'], ['today', 'Hoy'], ['tomorrow', 'Mañana'], ['week', 'Semana'], ['month', 'Mes'], ['range', 'Rango']] as const).map(([id, label]) =>
          <button key={id} type="button" className={id === period ? 'is-active' : ''} onClick={() => setPeriod(id)} aria-pressed={id === period}>{label}</button>
        )}
        <button type="button" aria-label="Actualizar panel" title="Actualizar" onClick={onRefresh}><RefreshCcw size={13} /></button>
      </div>
    </div>
    {period === 'range' && <div className="admin-home-range"><label>Desde <input type="date" value={rangeFrom} onChange={event => setRangeFrom(event.target.value)} /></label><label>Hasta <input type="date" min={rangeFrom} value={rangeTo} onChange={event => setRangeTo(event.target.value)} /></label></div>}
    <div className="admin-home-stats">
      <div className="admin-home-stat"><div><span>Reservas Hoy</span><strong>{stats?.todayBookings ?? todayBookings.length}</strong></div><span className="admin-home-stat-icon blue"><CalendarDays size={23} /></span></div>
      <div className="admin-home-stat"><div><span>Pendientes</span><strong>{stats?.pendingBookings ?? '—'}</strong><small>Requieren atención</small></div><span className="admin-home-stat-icon amber"><AlertCircle size={23} /></span></div>
      <div className="admin-home-stat"><div><span>Ocupación</span><strong>{stats?.occupancyRate ?? '—'}%</strong><small>Promedio del mes</small></div><span className="admin-home-stat-icon indigo"><TrendingUp size={23} /></span></div>
    </div>
    {displayedSections.map(section =>
      <section className="admin-home-section" key={section.id}>
        <div className="admin-home-section-head"><h2>{section.title} <span>({section.rows.length})</span></h2><button type="button" onClick={() => onSelect('bookings')}>Ver Todas</button></div>
        {section.rows.length === 0 ? <div className="admin-home-empty">{section.empty}</div> : (section.id === 'week' || section.id === 'period') ?
          grouped(section.rows).map(([date, rows]) => <div key={date} className="admin-home-day"><h3>{dateLabel(date)}</h3>{rows.map(bookingRow)}</div>) : section.rows.map(bookingRow)}
      </section>
    )}
    <section className="admin-home-section admin-home-quick">
      <div className="admin-home-section-head"><h2>Acciones Rápidas</h2></div>
      <div className="admin-home-quick-actions"><button type="button" onClick={() => onSelect('schedule')}><Clock3 size={17} /> Bloquear horario</button><button type="button" onClick={() => onSelect('fleet')}><Truck size={17} /> Configurar flota</button></div>
    </section>
    {(period === 'month' || period === 'range') && !extraInfoLoaded && <p className="admin-home-extra-note">No se pudo recuperar la lista mensual desde la API de reservas. Usa Hoy, Mañana o Semana mientras se revisa la conexión.</p>}
  </div>
}
