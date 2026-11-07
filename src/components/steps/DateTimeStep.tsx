'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useQuoteStore } from '@/store/quoteStore'
import Button from '../ui/Button'
import Checkbox from '../ui/Checkbox'
import Card from '../ui/Card'
import { Calendar, Clock, TrendingDown, AlertCircle, ChevronLeft, ChevronRight } from 'lucide-react'
import { format, addDays, isSameDay, startOfDay, endOfMonth, addMonths, startOfMonth, getMonth, getYear } from 'date-fns'
import { es } from 'date-fns/locale'
import toast from 'react-hot-toast'
import { dateSurcharge, type DateSurchargeKind } from '@/lib/quotePricing'
import { useTimeSurcharges } from '@/lib/useTimeSurcharges'
import { isPastMoveDate } from '@/lib/utils'

interface DateTimeStepProps {
  onNext: () => void
  onPrevious: () => void
}

interface SlotData {
  time: string
  label?: string
  recommended?: boolean
  availableSlots: number
  capacity: number
  booked: number
  isBlocked: boolean
  isAvailable: boolean
  occupancy: string
}

const NOMBRE_RECARGO: Record<DateSurchargeKind, string> = {
  saturday: 'sábado',
  sunday: 'domingo',
  holiday: 'feriado',
}

/** «Domingos y feriados tienen un recargo de 15%.» con los porcentajes del panel. */
function describeSurcharges(
  surcharges: { saturday: number; sunday: number; holiday: number } | null
): string | null {
  if (!surcharges) return null
  const dias = [
    { nombre: 'sábados', percent: Number(surcharges.saturday) || 0 },
    { nombre: 'domingos', percent: Number(surcharges.sunday) || 0 },
    { nombre: 'feriados', percent: Number(surcharges.holiday) || 0 },
  ].filter((d) => d.percent > 0)
  if (dias.length === 0) return null

  const unir = (partes: string[]) =>
    partes.length === 1 ? partes[0] : `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}`
  const mayuscula = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)

  if (dias.every((d) => d.percent === dias[0].percent)) {
    return `${mayuscula(unir(dias.map((d) => d.nombre)))} tienen un recargo de ${dias[0].percent}%.`
  }
  return `${mayuscula(unir(dias.map((d) => `${d.nombre} +${d.percent}%`)))}.`
}

export default function DateTimeStep({ onNext, onPrevious }: DateTimeStepProps) {
  const { dateTime, isFlexible, setDateTime } = useQuoteStore()
  const timeSurcharges = useTimeSurcharges()
  const textoRecargos = useMemo(() => describeSurcharges(timeSurcharges), [timeSurcharges])
  
  // Una fecha guardada que ya pasó no se precarga: hay que elegir otra.
  const savedDateTime = dateTime && !isPastMoveDate(dateTime) ? new Date(dateTime) : null
  const [selectedDate, setSelectedDate] = useState<Date | null>(savedDateTime)
  const [selectedTime, setSelectedTime] = useState<string>(
    savedDateTime ? format(savedDateTime, 'HH:mm') : ''
  )
  const [flexible, setFlexible] = useState(isFlexible)
  const [selectedMonth, setSelectedMonth] = useState<string>('')
  const [availableSlots, setAvailableSlots] = useState<SlotData[]>([])
  const [loadingSlots, setLoadingSlots] = useState(false)

  // Generar fechas disponibles (desde mañana hasta casi un año más, incluyendo domingos)
  // Rango ajustado: permite reservar hasta 11 meses hacia adelante
  const availableDates = useMemo(() => {
    const today = new Date()
    const tomorrow = startOfDay(addDays(today, 1))
    
    // Calcular el último día disponible: casi un año más (11 meses completos)
    // Ejemplo: si hoy es 05 nov 2024 → hasta 31 oct 2025
    const lastDay = startOfDay(endOfMonth(addMonths(today, 11)))
    
    // Calcular cuántos días hay desde mañana hasta el último día disponible (inclusive)
    const diffInMs = lastDay.getTime() - tomorrow.getTime()
    const totalDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24)) + 1
    
    const dates: Date[] = []
    for (let i = 0; i < totalDays; i++) {
      dates.push(addDays(tomorrow, i))
    }
    
    return dates
  }, [])

  // Agrupar fechas por mes
  const datesByMonth = useMemo(() => {
    return availableDates.reduce((acc, date) => {
      const monthKey = format(date, 'yyyy-MM')
      if (!acc[monthKey]) {
        acc[monthKey] = []
      }
      acc[monthKey].push(date)
      return acc
    }, {} as Record<string, Date[]>)
  }, [availableDates])

  // Obtener lista de meses disponibles (ordenados cronológicamente)
  const availableMonths = useMemo(() => {
    return Object.keys(datesByMonth)
      .sort() // Ordenar las claves yyyy-MM alfabéticamente (que es orden cronológico)
      .map(monthKey => {
        const firstDate = datesByMonth[monthKey][0]
        return {
          key: monthKey,
          label: format(firstDate, 'MMMM yyyy', { locale: es }),
          date: firstDate
        }
      })
  }, [datesByMonth])

  // Establecer el primer mes como seleccionado por defecto
  useEffect(() => {
    if (availableMonths.length > 0 && !selectedMonth) {
      setSelectedMonth(availableMonths[0].key)
    }
  }, [availableMonths, selectedMonth])

  // Set de fechas disponibles para lookup O(1)
  const availableDateSet = useMemo(() => {
    return new Set(availableDates.map(d => format(d, 'yyyy-MM-dd')))
  }, [availableDates])

  // Índice del mes seleccionado para navegación
  const currentMonthIndex = availableMonths.findIndex(m => m.key === selectedMonth)
  const canGoPrev = currentMonthIndex > 0
  const canGoNext = currentMonthIndex < availableMonths.length - 1

  const goToPrevMonth = () => {
    if (canGoPrev) setSelectedMonth(availableMonths[currentMonthIndex - 1].key)
  }
  const goToNextMonth = () => {
    if (canGoNext) setSelectedMonth(availableMonths[currentMonthIndex + 1].key)
  }

  // Grilla del calendario (Lu→Do), con celdas vacías de relleno
  const calendarGrid = useMemo(() => {
    if (!selectedMonth) return []
    const [year, month] = selectedMonth.split('-').map(Number)
    const firstOfMonth = new Date(year, month - 1, 1)
    const daysInMonth = endOfMonth(firstOfMonth).getDate()
    // Lunes = 0, ..., Domingo = 6
    const offset = (firstOfMonth.getDay() + 6) % 7
    const totalCells = Math.ceil((offset + daysInMonth) / 7) * 7
    const cells: (Date | null)[] = []
    for (let i = 0; i < offset; i++) cells.push(null)
    for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month - 1, d))
    while (cells.length < totalCells) cells.push(null)
    return cells
  }, [selectedMonth])

  const fetchAvailableSlots = useCallback(async () => {
    try {
      setLoadingSlots(true)
      const dateStr = format(selectedDate!, 'yyyy-MM-dd')
      const response = await fetch(`/api/bookings/available?date=${dateStr}`)
      
      if (!response.ok) {
        throw new Error('Error fetching slots')
      }
      
      const data: SlotData[] = await response.json()
      setAvailableSlots(data)
      
      // Si no hay horarios disponibles, limpiar selección
      if (data.length === 0) {
        setSelectedTime('')
      }
    } catch (error) {
      console.error('Error fetching available slots:', error)
      toast.error('Error al obtener disponibilidad')
      setAvailableSlots([])
    } finally {
      setLoadingSlots(false)
    }
  }, [selectedDate])

  // NUEVO: Traer disponibilidad cuando cambia la fecha
  useEffect(() => {
    if (selectedDate) {
      fetchAvailableSlots()
    }
  }, [selectedDate, fetchAvailableSlots])

  const handleSubmit = () => {
    if (!selectedDate) {
      toast.error('Por favor selecciona una fecha')
      return
    }

    if (!availableDateSet.has(format(selectedDate, 'yyyy-MM-dd'))) {
      toast.error('Esa fecha ya no está disponible. Elige otra en el calendario.')
      return
    }

    if (!selectedTime) {
      toast.error('Por favor selecciona un horario')
      return
    }

    const [hours, minutes] = selectedTime.split(':').map(Number)
    const dateWithTime = new Date(selectedDate)
    dateWithTime.setHours(hours, minutes, 0, 0)

    setDateTime(dateWithTime, flexible)
    toast.success('Fecha y hora guardadas')
    onNext()
  }

  return (
    <div className="max-w-4xl mx-auto animate-slide-up">
      <Card variant="elevated">
        <div className="mb-6">
          <h2 className="text-3xl font-bold text-gray-900 mb-2">Fecha y Hora de tu Mudanza</h2>
          <p className="text-gray-600">
            Selecciona cuándo quieres realizar tu mudanza
          </p>
        </div>

        {/* Descuento por flexibilidad */}
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6">
          <div className="flex items-start gap-3">
            <TrendingDown className="w-6 h-6 text-green-600 mt-0.5" />
            <div className="flex-1">
              <h3 className="font-semibold text-green-900 mb-1">
                🎉 ¡Ahorra hasta un 10% siendo flexible!
              </h3>
              <p className="text-sm text-green-800 mb-3">
                Si tienes flexibilidad en la fecha, podemos ofrecerte un mejor precio
              </p>
              <Checkbox
                label="Tengo flexibilidad de fecha (descuento del 10%)"
                checked={flexible}
                onChange={(e) => setFlexible(e.target.checked)}
              />
            </div>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {/* Selección de Fecha */}
          <div>
            <div className="flex items-center gap-2 mb-4">
              <Calendar className="w-5 h-5 text-primary-600" />
              <h3 className="text-lg font-semibold">Selecciona una Fecha</h3>
            </div>

            {/* Navegación de mes */}
            <div className="flex items-center justify-between mb-2">
              <button
                onClick={goToPrevMonth}
                disabled={!canGoPrev}
                className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                aria-label="Mes anterior"
              >
                <ChevronLeft className="w-5 h-5 text-gray-600" />
              </button>
              <span className="font-semibold text-gray-900 capitalize text-sm sm:text-base">
                {availableMonths.find(m => m.key === selectedMonth)?.label ?? ''}
              </span>
              <button
                onClick={goToNextMonth}
                disabled={!canGoNext}
                className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                aria-label="Mes siguiente"
              >
                <ChevronRight className="w-5 h-5 text-gray-600" />
              </button>
            </div>

            {/* Cabecera días de la semana */}
            <div className="grid grid-cols-7 mb-1">
              {['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá', 'Do'].map(d => (
                <div key={d} className="text-center text-xs font-semibold text-gray-400 py-1">
                  {d}
                </div>
              ))}
            </div>

            {/* Grilla del calendario */}
            <div className="grid grid-cols-7 gap-0.5 border border-gray-200 rounded-xl p-1.5 bg-gray-50">
              {calendarGrid.map((date, i) => {
                if (!date) {
                  return <div key={`empty-${i}`} className="aspect-square" />
                }
                const dateKey = format(date, 'yyyy-MM-dd')
                const isAvailable = availableDateSet.has(dateKey)
                const isSelected = selectedDate ? isSameDay(date, selectedDate) : false
                const recargo = dateSurcharge(dateKey, timeSurcharges)
                const conRecargo = recargo.kind !== null

                return (
                  <button
                    key={dateKey}
                    onClick={() => isAvailable && setSelectedDate(date)}
                    disabled={!isAvailable}
                    title={conRecargo && isAvailable && recargo.kind ? `+${recargo.percent}% recargo ${NOMBRE_RECARGO[recargo.kind]}` : undefined}
                    className={`
                      aspect-square flex flex-col items-center justify-center rounded-lg
                      text-xs sm:text-sm font-medium transition-all select-none
                      ${isAvailable ? 'hover:scale-105' : 'cursor-not-allowed'}
                      ${isSelected
                        ? 'bg-primary-600 text-white shadow-md scale-105'
                        : isAvailable
                          ? conRecargo
                            ? 'bg-yellow-50 hover:bg-yellow-100 border border-yellow-200 text-gray-800'
                            : 'bg-white hover:bg-primary-50 border border-gray-200 hover:border-primary-300 text-gray-800'
                          : 'bg-gray-100 border border-gray-200 text-gray-400 line-through decoration-gray-300'
                      }
                    `}
                  >
                    <span className="leading-none font-semibold">{format(date, 'd')}</span>
                    {conRecargo && isAvailable && !isSelected && (
                      <span className="text-[8px] sm:text-[9px] text-orange-400 leading-none mt-0.5 font-normal">
                        +{recargo.percent}%
                      </span>
                    )}
                  </button>
                )
              })}
            </div>

            {/* Leyenda */}
            <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
              {textoRecargos && (
                <span className="flex items-center gap-1">
                  <span className="w-3 h-3 rounded bg-yellow-100 border border-yellow-200 inline-block" />
                  Con recargo
                </span>
              )}
              <span className="flex items-center gap-1">
                <span className="w-3 h-3 rounded bg-primary-600 inline-block" />
                Seleccionado
              </span>
            </div>
          </div>

          {/* Selección de Hora - MEJORADO CON API */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Clock className="w-5 h-5 text-primary-600" />
                <h3 className="text-lg font-semibold">Selecciona un Horario</h3>
              </div>
              {selectedDate && availableSlots.length > 0 && (
                <div className="text-sm font-semibold text-gray-700 bg-blue-50 px-3 py-1 rounded flex items-center gap-1">
                  🚚 {availableSlots[0]?.capacity} camión{availableSlots[0]?.capacity > 1 ? 'es' : ''}
                </div>
              )}
            </div>

            {loadingSlots && selectedDate && (
              <div className="p-4 bg-blue-50 rounded-lg text-center">
                <p className="text-blue-700">Cargando disponibilidad...</p>
              </div>
            )}

            {!loadingSlots && selectedDate && availableSlots.length === 0 && (
              <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-center">
                <AlertCircle className="w-5 h-5 text-red-600 mx-auto mb-2" />
                <p className="text-red-700 font-semibold">
                  ❌ No hay disponibilidad para esta fecha
                </p>
                <p className="text-sm text-red-600 mt-1">
                  Por favor elige otro día
                </p>
              </div>
            )}

            {!loadingSlots && availableSlots.length > 0 && (
              <div className="space-y-2">
              {availableSlots.map((slotData) => {
                const isSelected = selectedTime === slotData.time

                return (
                  <button
                    key={slotData.time}
                    onClick={() => setSelectedTime(slotData.time)}
                    className={`
                      w-full p-4 rounded-lg border-2 text-left transition-all
                      ${isSelected 
                        ? 'border-primary-600 bg-primary-50 shadow-md' 
                        : 'border-gray-200 hover:border-primary-300'
                      }
                    `}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3 flex-1">
                        <span className="font-semibold w-16">{slotData.time} hrs</span>
                        
                        {/* Mostrar ocupación con iconos de camiones */}
                        <div className="flex items-center gap-1">
                          {Array.from({ length: slotData.capacity }).map((_, i) => (
                            <div
                              key={i}
                              className={`
                                w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold
                                ${i < slotData.booked
                                  ? 'bg-red-200 text-red-700'
                                  : 'bg-green-200 text-green-700'
                                }
                              `}
                              title={i < slotData.booked ? 'Ocupado' : 'Disponible'}
                            >
                              🚚
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="text-right">
                        <p className="font-semibold text-gray-700 text-sm">
                          {slotData.availableSlots} disponible{slotData.availableSlots !== 1 ? 's' : ''}
                        </p>
                        {slotData.recommended && (
                          <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded">
                            ⭐ Recomendado
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                )
              })}
              </div>
            )}

            {/* Resumen */}
            {selectedDate && selectedTime && (
              <div className="mt-6 p-4 bg-gray-50 rounded-lg">
                <h4 className="font-semibold mb-2">Selección Confirmada:</h4>
                <p className="text-gray-700">
                  📅 {format(selectedDate, "EEEE d 'de' MMMM", { locale: es })}
                </p>
                <p className="text-gray-700">
                  🕐 {selectedTime} hrs
                </p>
                {flexible && (
                  <p className="text-green-600 mt-2 text-sm font-semibold">
                    ✅ Con descuento por flexibilidad (-10%)
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Info */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mt-6">
          <p className="text-sm text-blue-800">
            <strong>💡 Tip:</strong> Las mudanzas en horario de mañana son más eficientes.
          </p>
          {textoRecargos && (
            <p className="text-sm text-blue-800 mt-2">
              <strong>🟡 Recargos:</strong> {textoRecargos}
            </p>
          )}
        </div>

        {/* Botones */}
        <div className="flex gap-4 mt-6">
          <Button
            type="button"
            onClick={onPrevious}
            variant="outline"
            className="flex-1"
          >
            ← Volver
          </Button>
          <Button
            onClick={handleSubmit}
            variant="brand"
            className="flex-1"
            disabled={!selectedDate || !selectedTime}
          >
            Continuar →
          </Button>
        </div>
      </Card>
    </div>
  )
}

