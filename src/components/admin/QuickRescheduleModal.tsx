'use client'

import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { AlertTriangle, CalendarClock, Pencil } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'

/** Lo mínimo de una reserva para moverla de día u hora. */
export interface ReschedulableBooking {
  id: string
  quote_id?: string | null
  client_name?: string | null
  scheduled_date?: string | null
  scheduled_time?: string | null
  duration_hours?: number | null
  vehicle_id?: number | null
  status?: string | null
}

interface QuickRescheduleModalProps {
  booking: ReschedulableBooking | null
  onClose: () => void
  /** Se llama con la fecha y hora nuevas ya guardadas. */
  onSaved: (bookingId: string, changes: { scheduled_date: string; scheduled_time: string }) => void
  /** Abre la edición completa de la misma reserva. */
  onOpenFullEdit: () => void
}

/**
 * Cambiar SOLO la fecha y la hora de una reserva, sin abrir la edición completa.
 *
 * Usa la misma ruta que «Editar» (`PATCH /api/admin/bookings/[id]`), así que el servidor
 * aplica las mismas reglas: si el horario está lleno o bloqueado responde 409 y acá se
 * muestra el aviso con la opción de agendar igual; y si el camión de la reserva ya tiene
 * otro trabajo a esa hora, se avisa sin bloquear, igual que en la edición completa.
 * Todo lo demás —precio, pago, direcciones, camión— se cambia en «Editar».
 */
export default function QuickRescheduleModal({
  booking,
  onClose,
  onSaved,
  onOpenFullEdit,
}: QuickRescheduleModalProps) {
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [saving, setSaving] = useState(false)
  const [capacityWarning, setCapacityWarning] = useState<string | null>(null)
  const [truckConflict, setTruckConflict] = useState<string | null>(null)

  const originalDate = booking?.scheduled_date || ''
  const originalTime = String(booking?.scheduled_time || '').slice(0, 5)

  useEffect(() => {
    setDate(originalDate)
    setTime(originalTime)
    setCapacityWarning(null)
    setTruckConflict(null)
    // Solo al cambiar de reserva: la fecha y hora las maneja el formulario después.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booking?.id])

  // Aviso de camión ocupado en el horario nuevo, con la misma consulta que usa «Editar».
  useEffect(() => {
    const ocupaCamion = booking && !['cancelled', 'no_show'].includes(String(booking.status || ''))
    const cambio = date !== originalDate || time !== originalTime
    if (!booking || !ocupaCamion || booking.vehicle_id == null || !date || !time || !cambio) {
      setTruckConflict(null)
      return
    }
    let vigente = true
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({
          date,
          time,
          duration: String(Number(booking.duration_hours) || 4),
          excludeId: booking.id,
        })
        const res = await fetch(`/api/admin/fleet-availability?${params}`)
        const data = await res.json().catch(() => null)
        if (!vigente || !res.ok || !data) return
        const camion = data.vehicles?.find((v: any) => v.id === booking.vehicle_id)
        setTruckConflict(
          camion && camion.status === 'active' && !camion.available
            ? `${camion.name} ya tiene otro trabajo a esa hora (${camion.overlapping
                .map((o: any) => `${o.from}–${o.to}`)
                .join(', ')}). Si guardas, queda así; el camión se cambia en «Editar».`
            : null
        )
      } catch {
        if (vigente) setTruckConflict(null)
      }
    }, 300)
    return () => {
      vigente = false
      clearTimeout(timer)
    }
  }, [booking, date, time, originalDate, originalTime])

  const save = async (overrideCapacity = false) => {
    if (!booking) return
    if (!date || !time) {
      toast.error('Elige la fecha y la hora')
      return
    }
    if (date === originalDate && time === originalTime) {
      toast('No cambiaste la fecha ni la hora')
      return
    }
    setSaving(true)
    try {
      const res = await fetch(`/api/admin/bookings/${booking.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scheduled_date: date,
          scheduled_time: time,
          override_capacity: overrideCapacity,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 409 && data?.requiresOverride) {
        setCapacityWarning(data.warning || 'Ese horario ya está ocupado.')
        return
      }
      if (!res.ok) throw new Error(data?.error || 'No se pudo cambiar el horario')
      toast.success('Fecha y hora actualizadas')
      onSaved(booking.id, { scheduled_date: date, scheduled_time: time })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo cambiar el horario')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal isOpen={Boolean(booking)} onClose={onClose} title="Cambiar fecha y hora" size="sm">
      {booking && (
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            {booking.client_name || 'Reserva'}
            {booking.quote_id ? <span className="text-gray-400"> · {booking.quote_id}</span> : null}
          </p>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Fecha</label>
              <Input
                type="date"
                value={date}
                onChange={(e) => {
                  setDate(e.target.value)
                  setCapacityWarning(null)
                }}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Hora</label>
              <Input
                type="time"
                value={time}
                onChange={(e) => {
                  setTime(e.target.value)
                  setCapacityWarning(null)
                }}
              />
            </div>
          </div>

          {truckConflict && (
            <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              <AlertTriangle className="h-4 w-4 flex-shrink-0" />
              <p>{truckConflict}</p>
            </div>
          )}

          {capacityWarning && (
            <div className="space-y-2 rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm text-orange-900">
              <p className="font-semibold">Ese horario está ocupado</p>
              <p className="text-xs">{capacityWarning}</p>
              <Button onClick={() => save(true)} size="sm" variant="outline" isLoading={saving}>
                Agendar igual
              </Button>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 pt-3">
            <button
              type="button"
              onClick={onOpenFullEdit}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-primary-600 hover:text-primary-700"
            >
              <Pencil className="h-3.5 w-3.5" />
              Editar todo lo demás
            </button>
            <div className="flex gap-2">
              <Button onClick={onClose} variant="outline" size="sm">
                Cancelar
              </Button>
              <Button onClick={() => save(false)} size="sm" isLoading={saving} disabled={Boolean(capacityWarning)}>
                <CalendarClock className="mr-1.5 h-4 w-4" />
                Guardar
              </Button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}
