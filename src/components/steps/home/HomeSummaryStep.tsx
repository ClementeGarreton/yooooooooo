'use client'

import { useState, useEffect } from 'react'
import { useHomeQuoteStore } from '@/store/homeQuoteStore'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import { User, Mail, Phone, MapPin, DollarSign, CheckCircle, CalendarDays, Clock } from 'lucide-react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import toast from 'react-hot-toast'
import { pushDataLayerMonto } from '@/lib/tracking'
import { attributionForSubmit } from '@/lib/attribution'
import { formatHomeVisitPrice } from '@/lib/homeVisitPricing'
import { useHomeVisitPrice } from '@/lib/useHomeVisitPrice'
import { isPastMoveDate } from '@/lib/utils'

interface HomeSummaryStepProps {
  onPrevious: () => void
  onReset: () => void
}

export default function HomeSummaryStep({ onPrevious, onReset }: HomeSummaryStepProps) {
  const { personalInfo, visitAddress, visitSchedule, setConfirmed } = useHomeQuoteStore()
  const [loading, setLoading] = useState(false)
  const price = useHomeVisitPrice()
  const fechaPasada = visitSchedule ? isPastMoveDate(`${visitSchedule.date}T00:00:00`) : false

  // Monto de la visita a domicilio al dataLayer (para GTM: evento "Pagar")
  useEffect(() => {
    pushDataLayerMonto(price)
  }, [price])

  const handlePayment = async () => {
    if (!personalInfo || !visitAddress || !visitSchedule) {
      toast.error('Faltan datos requeridos')
      return
    }
    if (fechaPasada) {
      toast.error('La fecha de tu visita ya pasó. Vuelve a «Fecha y Hora» y elige otra.')
      return
    }

    try {
      setLoading(true)

      // Un solo quote_id compartido entre prospecto y reserva: es la llave con la que
      // el webhook de pago encuentra al prospecto y lo marca como convertido.
      const quoteId = `DOMICILIO-${Date.now()}`

      // Guardar como prospecto
      const visitAddr = `${visitAddress.street} ${visitAddress.number}, ${visitAddress.commune}, ${visitAddress.region}${visitAddress.additionalInfo ? ` (${visitAddress.additionalInfo})` : ''}`
      fetch('/api/prospects/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'domicilio',
          quote_id: quoteId,
          name: personalInfo.name,
          email: personalInfo.email,
          phone: personalInfo.phone,
          visit_address: visitAddr,
          scheduled_date: visitSchedule.date,
          scheduled_time: visitSchedule.time,
          total_price: price,
          original_price: price,
          attribution: attributionForSubmit(),
        }),
      }).catch(err => console.error('Error saving domicilio prospect:', err))

      // Crear la reserva de tipo domicilio
      const bookingData = {
        quote_id: quoteId,
        client_name: personalInfo.name,
        client_email: personalInfo.email,
        client_phone: personalInfo.phone,
        booking_type: 'domicilio',
        visit_address: `${visitAddress.street} ${visitAddress.number}, ${visitAddress.commune}, ${visitAddress.region}${visitAddress.additionalInfo ? ` (${visitAddress.additionalInfo})` : ''}`,
        total_price: price,
        original_price: price,
        scheduled_date: visitSchedule.date,
        scheduled_time: visitSchedule.time,
        duration_hours: 1,
        attribution: attributionForSubmit(),
      }

      const bookingResponse = await fetch('/api/home-quote/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bookingData),
      })

      if (!bookingResponse.ok) {
        const errorData = await bookingResponse.json()
        throw new Error(errorData.error || 'Error al crear la reserva')
      }

      const { booking } = await bookingResponse.json()

      console.log('[Domicilio] Booking creado:', booking.id, 'Quote ID:', booking.quote_id)

      // Iniciar pago con Flow - Usar quote_id como commerceOrder para consistencia
      const paymentResponse = await fetch('/api/payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookingId: booking.quote_id, // Usar quote_id para que Flow lo devuelva
          amount: price,
          email: personalInfo.email, // Campo requerido por la API
          subject: 'Cotización a Domicilio - Yo Me Encargo',
          paymentType: 'completo',
        }),
      })

      if (!paymentResponse.ok) {
        throw new Error('Error al iniciar el pago')
      }

      const { paymentUrl } = await paymentResponse.json()

      // Marcar como confirmado y redirigir a Flow
      setConfirmed(true)
      window.location.href = paymentUrl
    } catch (error) {
      console.error('Error al procesar el pago:', error)
      toast.error(error instanceof Error ? error.message : 'Error al procesar el pago')
      setLoading(false)
    }
  }

  if (!personalInfo || !visitAddress || !visitSchedule) {
    return (
      <div className="max-w-2xl mx-auto">
        <Card>
          <div className="text-center py-12">
            <p className="text-red-600 mb-4">
              Faltan datos requeridos. Por favor, completa todos los pasos.
            </p>
            <Button onClick={onReset} variant="outline">
              Reiniciar
            </Button>
          </div>
        </Card>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto">
      <Card>
        <div className="mb-8">
          <h2 className="text-3xl font-bold text-gray-900 mb-2">
            Resumen de tu Cotización a Domicilio
          </h2>
          <p className="text-gray-600">
            Revisa los datos antes de proceder con el pago
          </p>
        </div>

        <div className="space-y-6">
          {/* Información Personal */}
          <div className="bg-gray-50 rounded-lg p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <User className="w-5 h-5 text-primary-600" />
              Datos Personales
            </h3>
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-gray-700">
                <User className="w-4 h-4 text-gray-400" />
                <span className="font-medium">Nombre:</span>
                <span>{personalInfo.name}</span>
              </div>
              <div className="flex items-center gap-2 text-gray-700">
                <Mail className="w-4 h-4 text-gray-400" />
                <span className="font-medium">Email:</span>
                <span>{personalInfo.email}</span>
              </div>
              <div className="flex items-center gap-2 text-gray-700">
                <Phone className="w-4 h-4 text-gray-400" />
                <span className="font-medium">Teléfono:</span>
                <span>{personalInfo.phone}</span>
              </div>
            </div>
          </div>

          {/* Dirección de Visita */}
          <div className="bg-blue-50 rounded-lg p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <MapPin className="w-5 h-5 text-blue-600" />
              Dirección de Visita
            </h3>
            <div className="space-y-2">
              <p className="text-gray-700">
                <span className="font-medium">Dirección:</span>{' '}
                {visitAddress.street} {visitAddress.number}
              </p>
              <p className="text-gray-700">
                <span className="font-medium">Comuna:</span> {visitAddress.commune}
              </p>
              <p className="text-gray-700">
                <span className="font-medium">Región:</span> {visitAddress.region}
              </p>
              {visitAddress.additionalInfo && (
                <p className="text-gray-700">
                  <span className="font-medium">Información adicional:</span>{' '}
                  {visitAddress.additionalInfo}
                </p>
              )}
            </div>
          </div>

          {/* Horario de visita */}
          <div className="rounded-lg border border-primary-200 bg-primary-50 p-6">
            <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold text-gray-900">
              <CalendarDays className="h-5 w-5 text-primary-600" />
              Fecha y hora reservadas
            </h3>
            <div className="flex flex-col gap-2 text-gray-700 sm:flex-row sm:items-center sm:gap-6">
              <span className="capitalize">
                {format(new Date(`${visitSchedule.date}T12:00:00`), "EEEE d 'de' MMMM 'de' yyyy", { locale: es })}
              </span>
              <span className="flex items-center gap-2 font-semibold text-primary-700">
                <Clock className="h-4 w-4" />
                {visitSchedule.time.slice(0, 5)} hrs
              </span>
            </div>
            {fechaPasada && (
              <p className="mt-3 text-sm font-medium text-red-600">
                Esta fecha ya pasó. Vuelve al paso «Fecha y Hora» y elige otra.
              </p>
            )}
          </div>

          {/* Precio */}
          <div className="bg-green-50 rounded-lg p-6 border-2 border-green-200">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2 flex items-center gap-2">
                  <DollarSign className="w-5 h-5 text-green-600" />
                  Precio del Servicio
                </h3>
                <p className="text-sm text-gray-600">
                  Visita a domicilio para cotización completa
                </p>
              </div>
              <div className="text-right">
                <p className="text-3xl font-bold text-green-600">
                  {formatHomeVisitPrice(price)}
                </p>
                <p className="text-xs text-gray-500">Precio fijo</p>
              </div>
            </div>
            <div className="bg-blue-50 border border-blue-300 rounded-lg p-3 mt-4">
              <p className="text-sm text-blue-900">
                💡 <strong>Importante:</strong> Si contratas el servicio de mudanza o transporte después de la cotización, 
                los {formatHomeVisitPrice(price)} pagados se descontarán del valor total del flete.
              </p>
            </div>
          </div>

          {/* Qué incluye */}
          <div className="bg-purple-50 rounded-lg p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              ¿Qué incluye el servicio?
            </h3>
            <ul className="space-y-2">
              {[
                'Visita profesional a tu domicilio',
                'Evaluación completa de tus muebles y objetos',
                'Cotización detallada y personalizada',
                'Recomendaciones de empaque y protección',
                'Sin compromiso de contratación',
              ].map((item, index) => (
                <li key={index} className="flex items-start gap-2 text-gray-700">
                  <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Información importante */}
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
            <p className="text-sm text-yellow-800">
              <strong>⚠️ Nota:</strong> Tu horario quedará reservado al completar el pago.
              Si necesitamos confirmar algún detalle de acceso, nos contactaremos contigo.
            </p>
          </div>
        </div>

        {/* Botones */}
        <div className="flex justify-between pt-6 mt-6 border-t">
          <Button
            onClick={onPrevious}
            variant="outline"
            disabled={loading}
          >
            ← Volver
          </Button>
          <Button
            onPointerDown={() => pushDataLayerMonto(price)}
            onClick={handlePayment}
            disabled={loading}
            size="lg"
          >
            {loading ? (
              <>
                <span className="animate-spin mr-2">⏳</span>
                Procesando...
              </>
            ) : (
              <>
                Pagar {formatHomeVisitPrice(price)} →
              </>
            )}
          </Button>
        </div>
      </Card>
    </div>
  )
}
