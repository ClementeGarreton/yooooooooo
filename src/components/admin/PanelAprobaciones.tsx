'use client'

import { useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2, ClipboardCheck, RefreshCcw } from 'lucide-react'

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

/** Solo muestra operaciones realmente disponibles en la API del proyecto.
 * El sistema de aprobación de trabajadores del panel de referencia no existe
 * en este backend; nunca debemos simular un «Aprobar» que no persiste.
 */
export default function PanelAprobaciones({ onOpen }: Props) {
  const [bookings, setBookings] = useState<Booking[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/admin/bookings', { cache: 'no-store' })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data: unknown = await response.json()
      if (!Array.isArray(data)) throw new Error('Formato de reservas inesperado')
      setBookings((data as Booking[]).filter(item => item.status === 'pending' && item.is_provisional !== true)
        .sort((a, b) => `${a.scheduled_date || ''} ${a.scheduled_time || ''}`.localeCompare(`${b.scheduled_date || ''} ${b.scheduled_time || ''}`)))
    } catch (err) { setError(err instanceof Error ? err.message : 'Error consultando reservas') }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])
  return <div className="admin-approval-view">
    <div className="admin-approval-heading"><div><h2>Por aprobar</h2><p>Solicitudes que esperan una decisión.</p></div><button type="button" onClick={() => void load()} disabled={loading}><RefreshCcw size={15}/> Actualizar</button></div>
    <section className="admin-approval-card"><div className="admin-approval-card-head"><div><h3>Reservas pendientes</h3><p>Abre una reserva para confirmar o modificar su estado desde la gestión existente.</p></div><span className="admin-approval-counter">{bookings.length} pendientes</span></div>
    {error ? <p role="alert" className="admin-calendar-error">{error}</p> : loading ? <p className="admin-approval-empty">Consultando reservas…</p> : bookings.length === 0 ? <p className="admin-approval-empty"><CheckCircle2 size={17}/> No hay reservas pendientes.</p> :
      bookings.map(booking => <div className="admin-approval-row" key={booking.id}><div><strong>{booking.client_name || 'Sin nombre'}</strong><p>{booking.quote_id || booking.id} · {booking.scheduled_date || 'Sin fecha'} {booking.scheduled_time?.slice(0,5) || ''}</p>{(booking.origin_address || booking.destination_address) && <small>{booking.origin_address || 'Origen pendiente'} → {booking.destination_address || 'Destino pendiente'}</small>}</div><button type="button" onClick={() => onOpen(booking)}>Ver reserva</button></div>)}
    </section>
    <section className="admin-approval-card"><div className="admin-approval-card-head"><div><h3>Trabajadores nuevos y gastos</h3><p>Estos módulos aparecen en el panel recuperado, pero no existen sus endpoints de aprobación en este proyecto.</p></div><AlertCircle size={20} color="#b8891e"/></div><div className="admin-approval-unavailable"><ClipboardCheck size={18}/> Sin operaciones disponibles: no se han inventado aprobaciones ni datos de trabajadores.</div></section>
  </div>
}
