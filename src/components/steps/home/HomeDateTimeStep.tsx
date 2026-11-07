'use client'

import { useEffect, useMemo, useState } from 'react'
import { CalendarDays, CheckCircle, Clock } from 'lucide-react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { useHomeQuoteStore } from '@/store/homeQuoteStore'
import Button from '@/components/ui/Button'
import Card from '@/components/ui/Card'
import Input from '@/components/ui/Input'
import { isPastMoveDate } from '@/lib/utils'

interface HomeDateTimeStepProps {
  onNext: () => void
  onPrevious: () => void
}

interface AvailableSlot {
  time: string
  label: string
  recommended?: boolean
  availableSlots: number
}

function toDateInputValue(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export default function HomeDateTimeStep({ onNext, onPrevious }: HomeDateTimeStepProps) {
  const { visitSchedule, setVisitSchedule } = useHomeQuoteStore()
  // La fecha guardada en el navegador (home-quote-storage) puede ser de una visita anterior: no se precarga si ya pasó.
  const savedSchedule = visitSchedule && !isPastMoveDate(`${visitSchedule.date}T00:00:00`) ? visitSchedule : null
  const [selectedDate, setSelectedDate] = useState(savedSchedule?.date || '')
  const [selectedTime, setSelectedTime] = useState(savedSchedule?.time || '')
  const [slots, setSlots] = useState<AvailableSlot[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const { minDate, maxDate } = useMemo(() => {
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    const maximum = new Date(tomorrow)
    maximum.setMonth(maximum.getMonth() + 11)
    return {
      minDate: toDateInputValue(tomorrow),
      maxDate: toDateInputValue(maximum),
    }
  }, [])

  useEffect(() => {
    if (!selectedDate) {
      setSlots([])
      return
    }

    const controller = new AbortController()
    const loadAvailability = async () => {
      setLoading(true)
      setError('')
      try {
        const response = await fetch(`/api/bookings/available?date=${selectedDate}`, {
          signal: controller.signal,
        })
        const data = await response.json()
        if (!response.ok) throw new Error(data?.error || 'No pudimos consultar los horarios')
        setSlots(data)
        setSelectedTime((currentTime) =>
          currentTime && data.some((slot: AvailableSlot) => slot.time === currentTime)
            ? currentTime
            : ''
        )
      } catch (requestError) {
        if (requestError instanceof DOMException && requestError.name === 'AbortError') return
        setSlots([])
        setSelectedTime('')
        setError(requestError instanceof Error ? requestError.message : 'No pudimos consultar los horarios')
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }

    loadAvailability()
    return () => controller.abort()
  }, [selectedDate])

  const handleDateChange = (date: string) => {
    setSelectedDate(date)
    setSelectedTime('')
  }

  const handleContinue = () => {
    if (!selectedDate || !selectedTime) return
    // El mínimo del campo no impide escribir a mano una fecha anterior.
    if (selectedDate < minDate || selectedDate > maxDate) {
      setError('Esa fecha no está disponible')
      return
    }
    setVisitSchedule({ date: selectedDate, time: selectedTime })
    onNext()
  }

  const formattedDate = selectedDate
    ? format(new Date(`${selectedDate}T12:00:00`), "EEEE d 'de' MMMM", { locale: es })
    : ''

  return (
    <div className="max-w-2xl mx-auto">
      <Card>
        <div className="mb-7">
          <h2 className="text-3xl font-bold text-gray-900 mb-2">Elige fecha y hora</h2>
          <p className="text-gray-600">
            Reserva el horario en que quieres recibir la visita de cotización.
          </p>
        </div>

        <div className="space-y-7">
          <div>
            <label className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-800">
              <CalendarDays className="h-5 w-5 text-primary-600" />
              Fecha de la visita
            </label>
            <Input
              type="date"
              min={minDate}
              max={maxDate}
              value={selectedDate}
              onChange={(event) => handleDateChange(event.target.value)}
            />
            <p className="mt-2 text-xs text-gray-500">Puedes reservar desde mañana.</p>
          </div>

          {selectedDate && (
            <div>
              <div className="mb-3 flex items-center justify-between gap-3">
                <label className="flex items-center gap-2 text-sm font-semibold text-gray-800">
                  <Clock className="h-5 w-5 text-primary-600" />
                  Horarios disponibles
                </label>
                <span className="text-xs capitalize text-gray-500">{formattedDate}</span>
              </div>

              {loading ? (
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-8 text-center text-sm text-gray-600">
                  Consultando disponibilidad…
                </div>
              ) : error ? (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {error}. Cambia la fecha o intenta nuevamente.
                </div>
              ) : slots.length === 0 ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  No quedan horarios disponibles para este día. Elige otra fecha.
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {slots.map((slot) => {
                    const isSelected = selectedTime === slot.time
                    return (
                      <button
                        key={slot.time}
                        type="button"
                        onClick={() => setSelectedTime(slot.time)}
                        aria-pressed={isSelected}
                        className={`rounded-xl border-2 px-3 py-3 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 ${
                          isSelected
                            ? 'border-primary-600 bg-primary-50 text-primary-900'
                            : 'border-gray-200 bg-white text-gray-800 hover:border-primary-300 hover:bg-primary-50/40'
                        }`}
                      >
                        <span className="flex items-center justify-between gap-2 font-semibold">
                          {slot.label || `${slot.time} hrs`}
                          {isSelected && <CheckCircle className="h-4 w-4 text-primary-600" />}
                        </span>
                        <span className="mt-1 block text-xs text-gray-500">
                          {slot.availableSlots === 1 ? 'Último cupo' : `${slot.availableSlots} cupos`}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          <div className="flex justify-between border-t pt-6">
            <Button onClick={onPrevious} variant="outline">← Volver</Button>
            <Button onClick={handleContinue} disabled={!selectedDate || !selectedTime || loading}>
              Continuar →
            </Button>
          </div>
        </div>
      </Card>
    </div>
  )
}
