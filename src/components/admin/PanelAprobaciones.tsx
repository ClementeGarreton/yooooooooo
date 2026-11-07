'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2, ClipboardCheck, RefreshCcw, Users } from 'lucide-react'

type Booking = {
  id: string
  quote_id?: string | null
  client_name?: string | null
  scheduled_date?: string | null
  scheduled_time?: string | null
  status?: string | null
  is_provisional?: boolean | null
  origin_address?: string | null
  destination_address?: string | null
}
type Props = { onOpen: (booking: { quote_id?: string | null; client_name?: string | null }) => void }

/** Datos reales: reservas pendientes de /api/admin/bookings.
 * El backend de este proyecto no tiene aprobaciones de trabajadores/gastos. */
export default function PanelAprobaciones({ onOpen }: Props) {
  const [bookings, setBookings] = useState<Booking[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/admin/bookings', { cache: 'no-store' })
      if (!response.ok) throw new Error(`Error HTTP ${response.status}`)
      const data: unknown = await response.json()
      if (!Array.isArray(data)) throw new Error('Formato de reservas inesperado')
      setBookings((data as Booking[]).filter(item => item.status === 'pending' && item.is_provisional !== true)
        .sort((a, b) => `${a.scheduled_date || ''} ${a.scheduled_time || ''}`.localeCompare(`${b.scheduled_date || ''} ${b.scheduled_time || ''}`)))
    } catch (err) { setError(err instanceof Error ? err.message : 'Error consultando reservas') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])
  return <div className="admin-approval-view">
    <section className="admin-approval-card">
      <div className="admin-approval-card-head"><div><h3>Trabajadores nuevos</h3><p>En el panel original se registran y aprueban trabajadores antes de incorporarlos al equipo.</p></div><Users size={20} color="#6d8fae"/></div>
      <div className="admin-approval-unavailable"><AlertCircle size={18}/> Aprobaciones de trabajadores no disponibles: esta versión no dispone de la API correspondiente.</div>
    </section>
    <div className="admin-approval-heading"><div><h2>Por aprobar</h2><p>Reservas pendientes que requieren tu decisión.</p></div><button type="button" onClick={() => void load()} disabled={loading}><RefreshCcw size={15}/> Actualizar</button></div>
    <section className="admin-approval-card"><div className="admin-approval-card-head"><div><h3>Reservas pendientes</h3><p>Abre una reserva para confirmar o modificar su estado mediante la gestión existente.</p></div><span className="admin-approval-counter">{loading ? 'Consultando…' : `${bookings.length} pendientes`}</span></div>
      {error ? <p role="alert" className="admin-calendar-error">{error}</p> : loading ? <p className="admin-approval-empty">Consultando reservas…</p> : bookings.length === 0 ? <p className="admin-approval-empty"><CheckCircle2 size={17}/> No hay reservas pendientes.</p> :
        bookings.map(booking => <div className="admin-approval-row" key={booking.id}><div><strong>{booking.client_name || 'Sin nombre'}</strong><p>{booking.quote_id || booking.id} · {booking.scheduled_date || 'Sin fecha'} {booking.scheduled_time?.slice(0, 5) || ''}</p>{(booking.origin_address || booking.destination_address) && <small>{booking.origin_address || 'Origen pendiente'} → {booking.destination_address || 'Destino pendiente'}</small>}</div><button type="button" onClick={() => onOpen(booking)}>Ver reserva</button></div>)}
    </section>
    <section className="admin-approval-card"><div className="admin-approval-card-head"><div><h3>Gastos de trabajadores y documentos</h3><p>Recepciones, rendiciones y fotografías sin monto.</p></div><ClipboardCheck size={20} color="#6d8fae"/></div><div className="admin-approval-unavailable"><AlertCircle size={18}/> Consulta y aprobación de gastos pendientes de conexión al servidor. No se registrarán gastos ficticios.</div></section>
  </div>
}
