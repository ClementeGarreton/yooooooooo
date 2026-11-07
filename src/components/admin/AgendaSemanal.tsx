'use client'

import { useState } from 'react'
import { CalendarDays, Briefcase, Clock, Search } from 'lucide-react'

export interface AgendaBooking {
  id: string
  quote_id?: string
  client_name: string
  client_phone: string
  scheduled_date: string
  scheduled_time: string
  status: string
  estimated_price: number | null
}

type Props = {
  bookings: AgendaBooking[]
  onOpen: (booking: AgendaBooking) => void
  mode?: 'calendar' | 'jobs'
}

const dateLabel = (date: string) => {
  const [year, month, day] = date.split('-').map(Number)
  return new Intl.DateTimeFormat('es-CL', { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(year, month - 1, day))
}

export default function AgendaSemanal({ bookings, onOpen, mode = 'calendar' }: Props) {
  const [search, setSearch] = useState('')
  const filtered = bookings
    .filter(booking => (mode === 'jobs' ? booking.status !== 'cancelled' : true))
    .filter(booking => `${booking.client_name} ${booking.client_phone} ${booking.quote_id || ''}`.toLocaleLowerCase('es').includes(search.toLocaleLowerCase('es')))
    .sort((a,b) => `${a.scheduled_date} ${a.scheduled_time}`.localeCompare(`${b.scheduled_date} ${b.scheduled_time}`))
  // El endpoint actual expone hoy y los próximos seis días, no un calendario mensual.
  // Mostrar los siete días incluso si no hay reservas evita una agenda incompleta.
  const todayCL = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date())
  const dates = Array.from({ length: 7 }, (_, offset) => {
    const [year, month, day] = todayCL.split('-').map(Number)
    const date = new Date(Date.UTC(year, month - 1, day + offset))
    return date.toISOString().slice(0, 10)
  })
  return <div className="space-y-4">
    <div className="admin-section-toolbar">
      <div className="flex items-center gap-3">
        {mode === 'calendar' ? <CalendarDays size={22} className="text-blue-600"/> : <Briefcase size={22} className="text-blue-600"/>}
        <div><h2>{mode === 'calendar' ? 'Agenda operativa' : 'Próximos trabajos'}</h2>
          <p>Reservas reales · próximas fechas disponibles en la API actual</p></div>
      </div>
      <label className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-500"><Search size={16}/><input aria-label="Buscar reserva" className="w-44 max-w-full outline-none" placeholder="Buscar cliente o reserva" value={search} onChange={event=>setSearch(event.target.value)}/></label>
    </div>
    {mode === 'jobs' && filtered.length === 0 ? (
      <div className="rounded-xl border border-gray-200 bg-white px-8 py-14 text-center text-sm text-gray-500">No hay trabajos en el período consultado.</div>
    ) : (
      <div className={mode === 'calendar' ? 'grid gap-3 md:grid-cols-2 xl:grid-cols-3' : 'grid gap-3 md:grid-cols-2'}>
        {dates.map(date => {
          const items = filtered.filter(booking=>booking.scheduled_date===date)
          if (mode === 'jobs' && !items.length) return null
          return <section key={date} className="admin-agenda-day"><h3 className="capitalize">{dateLabel(date)} <span className="float-right font-normal">{items.length} reserva{items.length===1?'':'s'}</span></h3>
            {items.length ? items.map(booking=><button type="button" key={booking.id} onClick={()=>onOpen(booking)} title="Ver detalle de reserva">
              <span className="flex justify-between gap-2 font-bold"><span className="truncate">{booking.client_name || 'Sin nombre'}</span><span className="text-blue-700">{booking.scheduled_time?.slice(0,5)}</span></span>
              <span className="mt-1 flex items-center justify-between gap-2 text-xs text-slate-500"><span>{booking.client_phone}</span><span>${Math.round(booking.estimated_price||0).toLocaleString('es-CL')}</span></span>
              <span className="mt-1 inline-flex items-center gap-1 text-[11px] text-slate-500"><Clock size={11}/>{booking.status}</span>
            </button>) : <p className="admin-agenda-empty">Sin reservas</p>}
          </section>
        })}
      </div>
    )}
  </div>
}
