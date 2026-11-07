'use client'

import { useEffect, useMemo, useState } from 'react'
import { CalendarDays, RefreshCw } from 'lucide-react'

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
  booking_type?: string | null
}

type Props = { onOpen: (booking: { quote_id?: string | null; client_name?: string | null }) => void }
type Period = 'today' | 'tomorrow' | 'week' | 'month' | 'range'
const chileToday = () => new Intl.DateTimeFormat('en-CA', {timeZone:'America/Santiago', year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
function shiftDays(date: string, days: number) {const [y,m,d] = date.split('-').map(Number);return new Date(Date.UTC(y,m-1,d+days)).toISOString().slice(0,10)}
function displayDate(date: string) {const [year,month,day] = date.split('-').map(Number); return new Intl.DateTimeFormat('es-CL', {weekday:'long',day:'numeric',month:'long'}).format(new Date(year,month-1,day))}
const statusLabel: Record<string,string> = {pending:'Pendiente',confirmed:'Confirmada',completed:'Finalizada',cancelled:'Cancelada',no_show:'No asistió'}

export default function TrabajosPorFecha({onOpen}:Props) {
  const [bookings,setBookings] = useState<Booking[]>([])
  const [period,setPeriod] = useState<Period>('week')
  const [from,setFrom] = useState(chileToday())
  const [to,setTo] = useState(shiftDays(chileToday(),13))
  const [search,setSearch] = useState('')
  const [loading,setLoading] = useState(true)
  const [error,setError] = useState('')
  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const response=await fetch('/api/admin/bookings',{cache:'no-store'})
      if(!response.ok) throw new Error(`Error HTTP ${response.status}`)
      const data:unknown=await response.json()
      if(!Array.isArray(data)) throw new Error('La API devolvió datos inesperados')
      setBookings(data as Booking[])
    }catch(err){setError(err instanceof Error ? err.message:'No se pudieron consultar los trabajos')}
    finally{setLoading(false)}
  }
  useEffect(()=>{void load()},[])
  const today=chileToday()
  const filtered=useMemo(()=>{
    let start=today,end=shiftDays(today,6)
    if(period==='tomorrow'){start=shiftDays(today,1);end=start}
    if(period==='today')end=start
    if(period==='month')end=shiftDays(today,29)
    if(period==='range'){start=from;end=to}
    return bookings.filter(b=>b.scheduled_date && b.scheduled_date>=start && b.scheduled_date<=end && b.status!=='cancelled' && `${b.client_name||''} ${b.client_phone||''} ${b.quote_id||''} ${b.origin_address||''} ${b.destination_address||''}`.toLocaleLowerCase('es').includes(search.toLocaleLowerCase('es'))).sort((a,b)=>`${a.scheduled_date} ${a.scheduled_time||''}`.localeCompare(`${b.scheduled_date} ${b.scheduled_time||''}`))
  },[bookings,period,from,to,search,today])
  const groups=useMemo(()=>{const out=new Map<string,Booking[]>();for(const booking of filtered){const date=booking.scheduled_date||'';out.set(date,[...(out.get(date)||[]),booking])}return Array.from(out.entries())},[filtered])
  return <div className="admin-jobs-view">
    <div className="admin-section-toolbar"><div><h2>Trabajos</h2><p>Reservas operativas ordenadas por fecha y hora · pulsa para abrir su ficha</p></div><button className="admin-jobs-reload" type="button" onClick={()=>void load()} disabled={loading}><RefreshCw size={14}/>{loading?'Actualizando…':'Actualizar'}</button></div>
    <div className="admin-jobs-filters"><div className="admin-range-tabs" role="group" aria-label="Periodo">{([['today','Hoy'],['tomorrow','Mañana'],['week','Semana'],['month','Mes'],['range','Rango']] as const).map(([key,label])=><button key={key} type="button" onClick={()=>setPeriod(key)} className={period===key?'is-active':''}>{label}</button>)}</div>
      {period==='range' && <div className="admin-jobs-dates"><label>Desde <input aria-label="Desde" type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label><label>Hasta <input aria-label="Hasta" type="date" value={to} onChange={e=>setTo(e.target.value)}/></label></div>}
      <input type="search" aria-label="Buscar trabajo" placeholder="Buscar cliente, cotización o dirección" value={search} onChange={e=>setSearch(e.target.value)}/>
    </div>
    {error && <p role="alert" className="admin-calendar-error">No se pudieron consultar los trabajos: {error}</p>}
    {loading ? <p className="admin-jobs-empty">Cargando trabajos…</p> : !error && groups.length===0 ? <p className="admin-jobs-empty">No hay reservas en el período seleccionado.</p> : groups.map(([date,rows])=><section className="admin-jobs-day" key={date}><h3><CalendarDays size={15}/>{displayDate(date)} <span>({rows.length})</span></h3>{rows.map((booking)=><button type="button" key={booking.id} className="admin-jobs-booking" onClick={()=>onOpen(booking)}><span className="admin-jobs-time">{booking.scheduled_time?.slice(0,5)||'--:--'}</span><span className="admin-jobs-details"><strong>{booking.client_name||'Sin nombre'}</strong><small>{booking.quote_id||booking.id}</small><span>{[booking.origin_address,booking.destination_address].filter(Boolean).join(' → ')||'Ver direcciones en la reserva'}</span></span><span className="admin-jobs-status">{statusLabel[booking.status||'']||booking.status||'Sin estado'}</span></button>)}</section>)}
  </div>
}
