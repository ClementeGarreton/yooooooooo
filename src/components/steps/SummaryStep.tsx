'use client'

import { useEffect, useState, useRef } from 'react'
import { useQuoteStore } from '@/store/quoteStore'
import Button from '../ui/Button'
import Card from '../ui/Card'
import {
  Calendar,
  MapPin,
  Package,
  DollarSign,
  Send,
  CheckCircle,
  CreditCard,
  Mail,
  Clock,
  ShieldCheck,
} from 'lucide-react'
import { formatCurrency, formatDate, formatTime, formatDistanceKm, isPastMoveDate } from '@/lib/utils'
import { generateQuotePDF } from '@/lib/pdfGenerator'
import { buildQuoteProspectBody } from '@/lib/quoteProspectPayload'
import { buildQuoteState } from '@/lib/quoteState'
import { getPricingConfig } from '@/lib/pricingService'
import { trackEvent, pushDataLayerMonto } from '@/lib/tracking'
import { attributionForSubmit } from '@/lib/attribution'
import toast from 'react-hot-toast'
import { format } from 'date-fns'
import { formatStopAddress } from '@/lib/stops'
import type { CouponQuote } from '@/lib/couponTypes'
import { depositAmount } from '@/lib/revenueBreakdown'
import {
  DEFAULT_EXTRA_SERVICES,
  hasFridge,
  overCapacitySurcharge,
  trucksNeeded,
} from '@/lib/extraServices'

// Configuración de precios por defecto para evitar errores
const DEFAULT_PRICING = {
  services: {
    disassembly: 15000,
    assembly: 15000,
    packing: 0, // No se muestra precio, requiere contacto con ejecutivo
    unpacking: 0, // No se muestra precio, requiere contacto con ejecutivo
    fridgeDisassembly: DEFAULT_EXTRA_SERVICES.fridgeDisassembly,
    priority: DEFAULT_EXTRA_SERVICES.priority,
    overCapacityThresholdM3: DEFAULT_EXTRA_SERVICES.overCapacityThresholdM3,
    overCapacityPrice: DEFAULT_EXTRA_SERVICES.overCapacityPrice
  }
}

interface SummaryStepProps {
  onPrevious: () => void
  onReset: () => void
  currentStep: number
}

export default function SummaryStep({ onPrevious, onReset }: SummaryStepProps) {
  const {
    personalInfo,
    dateTime,
    isFlexible,
    origin,
    destination,
    items,
    additionalServices,
    stops,
    totalVolume,
    totalWeight,
    totalDistance,
    estimatedPrice,
    recommendedVehicle,
    requiredCrew,
    totalCrew,
    isConfirmed,
    calculateTotals,
    setConfirmed,
  } = useQuoteStore()

  const [freeKilometers, setFreeKilometers] = useState(50) // Valor por defecto
  const [pricingConfig, setPricingConfig] = useState(DEFAULT_PRICING) // Configuración dinámica

  // Cargar configuración de precios dinámicamente desde el panel de admin
  useEffect(() => {
    const loadPricingConfig = async () => {
      try {
        const pricing = await getPricingConfig()
        setFreeKilometers(pricing.freeKilometers)

        // Actualizar la configuración de precios con los valores del admin
        setPricingConfig({
          services: {
            disassembly: pricing.additionalServices.disassembly,
            assembly: pricing.additionalServices.assembly,
            packing: 0, // No se muestra precio, requiere contacto con ejecutivo
            unpacking: 0, // No se muestra precio, requiere contacto con ejecutivo
            fridgeDisassembly: pricing.additionalServices.fridgeDisassembly,
            priority: pricing.additionalServices.priority,
            overCapacityThresholdM3: pricing.additionalServices.overCapacityThresholdM3,
            overCapacityPrice: pricing.additionalServices.overCapacityPrice
          }
        })
      } catch (error) {
        console.error('Error loading pricing config:', error)
        // Mantener los valores por defecto si falla
      }
    }
    loadPricingConfig()
  }, [])

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSendingQuote, setIsSendingQuote] = useState(false)
  // UNA casilla para todo: Términos y Condiciones, Políticas de Garantía y Política de
  // Privacidad. Es obligatoria para pagar (50% o 100%) y para pedir la cotización por
  // correo. Antes había dos casillas —una para pagar y otra para el correo— y el cliente
  // aceptaba lo mismo dos veces (lo notó Francisco el 01-10-2026). Si intenta seguir sin
  // marcarla, se resalta y se le lleva a ella.
  const [acceptedPolicies, setAcceptedPolicies] = useState(false)
  const [policiesError, setPoliciesError] = useState(false)
  const policiesRef = useRef<HTMLLabelElement>(null)
  const prospectSavedRef = useRef(false)
  // Cupón o código de referido (campaña OCTUBRE: «reservando en nuestra web»). El servidor
  // lo vuelve a validar al pagar; acá solo se muestra el descuento.
  // El código del link de un recomendador queda cargado (ver cotizador/page.tsx).
  const [couponInput, setCouponInput] = useState(() => {
    try {
      return typeof window === 'undefined' ? '' : localStorage.getItem('yme_codigo') || ''
    } catch {
      return ''
    }
  })
  const autoAppliedRef = useRef(false)
  const [coupon, setCoupon] = useState<CouponQuote | null>(null)
  const [couponBusy, setCouponBusy] = useState(false)
  const [couponError, setCouponError] = useState('')
  // Si cambia el precio (volvió atrás y cambió algo), el descuento calculado ya no vale.
  useEffect(() => {
    setCoupon(null)
  }, [estimatedPrice])
  const payPrice = coupon ? coupon.finalPrice : estimatedPrice

  // El cálculo es asíncrono: el auto-guardado lo espera antes de guardar y armar el PDF.
  const totalsReadyRef = useRef<Promise<void>>(Promise.resolve())
  useEffect(() => {
    totalsReadyRef.current = calculateTotals().catch((error) => {
      console.error('[SummaryStep] Error al calcular los totales:', error)
    })
  }, [calculateTotals])

  // CRO: vista del checkout (una sola vez)
  useEffect(() => {
    trackEvent('view_checkout_summary', { value: estimatedPrice, currency: 'CLP' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const prospectIdRef = useRef<string | null>(null)
  const pdfUrlRef = useRef<string | null>(null)

  // ID único y ESTABLE de esta cotización (un solo booking por cotización).
  // Lo comparten el envío por correo y los botones de pago en página => sin duplicados.
  // Se persiste en sessionStorage para que sobreviva una recarga (F5): así no se generan
  // múltiples pre-reservas provisionales "fantasma" para el mismo cliente.
  const quoteIdRef = useRef<string | null>(null)
  const getQuoteId = () => {
    if (!quoteIdRef.current) {
      const stored =
        typeof window !== 'undefined' ? sessionStorage.getItem('yme_quote_id') : null
      quoteIdRef.current = stored || `Q-${Date.now()}`
      if (typeof window !== 'undefined') {
        sessionStorage.setItem('yme_quote_id', quoteIdRef.current)
      }
    }
    return quoteIdRef.current
  }

  // Payload común (cliente + agenda + direcciones + precio) para checkout y correo
  const buildQuotePayload = () => ({
    client: {
      name: personalInfo?.name,
      email: personalInfo?.email,
      phone: personalInfo?.phone,
      isCompany: personalInfo?.isCompany || false,
      companyName: personalInfo?.companyName,
      companyRut: personalInfo?.companyRut,
    },
    schedule: {
      date: dateTime ? format(new Date(dateTime), 'yyyy-MM-dd') : null,
      time: dateTime ? format(new Date(dateTime), 'HH:mm') : null,
    },
    addresses: {
      origin: buildAddress(origin),
      destination: buildAddress(destination),
    },
    // Paradas intermedias: sin ellas la reserva quedaba solo con origen y destino.
    stops,
    // Piso, ascensor y distancia estacionamiento->puerta de origen/destino: se capturan
    // en el cotizador pero antes se perdían al guardar — nunca llegaban a la reserva ni a
    // la Orden de Trabajo que reciben los trabajadores.
    propertyDetails: {
      origin: origin.details
        ? {
            floor: origin.details.floor,
            hasElevator: origin.details.hasElevator,
            parkingDistance: origin.details.parkingDistance,
          }
        : null,
      destination: destination.details
        ? {
            floor: destination.details.floor,
            hasElevator: destination.details.hasElevator,
            parkingDistance: destination.details.parkingDistance,
          }
        : null,
    },
    estimatedPrice,
    // Lo que el cliente declaró: con esto el servidor recalcula el precio antes de cobrar.
    pricingInput: buildQuoteState({ dateTime, isFlexible, origin, destination, stops, items, additionalServices }),
    photoUrls: additionalServices?.photos || [],
    // gclid/UTMs capturados de la URL: para el pago en pagina y el envio por correo.
    attribution: attributionForSubmit(),
  })

  const saveProspect = async (source: string): Promise<string | null> => {
    try {
      // El cuerpo lo arma `buildQuoteProspectBody`, compartido con el cotizador interno
      // del panel: la cotización se guarda igual venga de donde venga.
      const res = await fetch('/api/prospects/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // Del store, no del render: el PDF se arma con esos mismos valores. Con los del render,
          // la cotización quedaba con el precio de antes de recalcular (sin el ayudante adicional,
          // COT-001699: $46.920 en la ficha y $71.920 en el PDF) y eso es lo que decía el correo.
          ...buildQuoteProspectBody(
            useQuoteStore.getState(),
            {
            source,
            quoteId: getQuoteId(),
            overCapacity: {
              overCapacityThresholdM3: pricingConfig.services.overCapacityThresholdM3,
              overCapacityPrice: pricingConfig.services.overCapacityPrice,
            },
            }
          ),
          // gclid/UTMs capturados de la URL (Google Ads). Solo en la web: en el panel la
          // cookie sería de la secretaria.
          attribution: attributionForSubmit(),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.prospectId) {
        console.error('Error saving prospect:', !res.ok ? data?.error || res.status : 'sin prospectId')
        return null
      }
      prospectSavedRef.current = true
      prospectIdRef.current = data.prospectId
      return data.prospectId
    } catch (error) {
      console.error('Error saving prospect:', error)
      return null
    }
  }

  const uploadProspectPdf = async (blob: Blob, fileName: string): Promise<boolean> => {
    const pid = prospectIdRef.current
    const email = personalInfo?.email
    if (!pid && !email) return false
    try {
      const formData = new FormData()
      formData.append('pdf', blob, fileName)
      if (pid) formData.append('prospectId', pid)
      if (email) formData.append('prospectEmail', email)
      const res = await fetch('/api/prospects/upload-pdf', { method: 'POST', body: formData })
      const data = await res.json().catch(() => ({}))
      if (data?.pdfUrl) pdfUrlRef.current = data.pdfUrl
      if (!res.ok) {
        console.error('Error uploading prospect PDF:', data?.error || res.status)
        return false
      }
      if (data.warning) {
        console.warn('PDF subido pero no vinculado al prospecto')
        return false
      }
      return true
    } catch (err) {
      console.error('Error uploading prospect PDF:', err)
      return false
    }
  }

  // Envío REAL de la cotización por correo: genera el link de pago (abono 50%)
  // y dispara el webhook de n8n con el PDF + link. El cliente paga desde el correo.
  const handleSendQuote = async () => {
    if (fechaPasada) {
      toast.error('La fecha de tu mudanza ya pasó. Vuelve a «Fecha y Hora» y elige otra.')
      return
    }
    if (!acceptedPolicies) {
      setPoliciesError(true)
      toast.error('Debes aceptar los Términos y Condiciones, las Políticas de Garantía y la Política de Privacidad.')
      policiesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }
    setIsSendingQuote(true)
    trackEvent('click_enviar_cotizacion_email', { value: estimatedPrice, currency: 'CLP' })
    try {
      let prospectId = prospectIdRef.current
      if (!prospectSavedRef.current) {
        prospectId = await saveProspect('email_quote')
      }

      // Garantizar el PDF ANTES de enviar el correo: si la subida automática del
      // resumen no alcanzó a terminar (o falló), lo generamos y subimos ahora,
      // así el correo siempre incluye un PDF descargable.
      if (!pdfUrlRef.current) {
        try {
          const result = await generateQuotePDF({ download: false })
          if (result?.blob) {
            await uploadProspectPdf(result.blob, result.fileName)
          }
        } catch (e) {
          console.error('[SummaryStep] No se pudo generar/subir el PDF antes del envío:', e)
        }
      }

      const res = await fetch('/api/prospects/send-quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quoteId: getQuoteId(),
          prospectId: prospectId || prospectIdRef.current,
          pdfUrl: pdfUrlRef.current,
          // Esta casilla incluye las Políticas de Garantía: queda guardada en la reserva.
          policiesAccepted: acceptedPolicies,
          details: {
            distanceKm: totalDistance,
            volumeM3: totalVolume,
            vehicle: recommendedVehicle,
            isFlexible,
          },
          ...buildQuotePayload(),
        }),
      })

      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.error || 'No se pudo enviar la cotización')
      }

      // Tracking: Lead (ahora sí, cuando el correo se envía de verdad)
      trackEvent('Lead', {
        method: 'email_quote',
        value: estimatedPrice,
        currency: 'CLP',
      })

      toast.success('¡Te enviamos tu cotización y link de pago al correo!')
    } catch (error) {
      console.error('Error sending quote:', error)
      toast.error(error instanceof Error ? error.message : 'No se pudo enviar la cotización')
    } finally {
      setIsSendingQuote(false)
    }
  }

  // Función helper para construir dirección completa
  const buildAddress = (addr: any) => {
    if (!addr.address) return ''

    const parts = [
      addr.address.street,
      addr.address.number,
      addr.address.commune,
      addr.address.region
    ].filter(Boolean)

    if (addr.address.additionalInfo) {
      parts.push(addr.address.additionalInfo)
    }

    return parts.join(', ')
  }

  // Fecha guardada en el navegador que ya pasó (se saltó el paso «Fecha y Hora»): no se
  // guarda, no se envía ni se paga hasta elegir otra.
  const fechaPasada = isPastMoveDate(dateTime)

  const summaryDataReadyForPdf =
    Boolean(
      !fechaPasada &&
      personalInfo?.name?.trim() &&
        personalInfo?.email?.trim() &&
        personalInfo?.phone?.trim() &&
        origin?.address &&
        destination?.address &&
        items?.length > 0
    )

  const summaryAutoPdfLockRef = useRef(false)

  useEffect(() => {
    if (isConfirmed || !summaryDataReadyForPdf) return
    if (summaryAutoPdfLockRef.current) return
    summaryAutoPdfLockRef.current = true

    let cancelled = false

    const run = async () => {
      let success = false
      try {
        await totalsReadyRef.current
        if (cancelled) return
        if (!prospectSavedRef.current) {
          const id = await saveProspect('web')
          if (cancelled || !id) return
        }
        const result = await generateQuotePDF({ download: false })
        if (cancelled || !result?.blob) return
        const ok = await uploadProspectPdf(result.blob, result.fileName)
        if (!cancelled && ok) success = true
      } catch (e) {
        if (!cancelled) console.error('[SummaryStep] Auto-guardado PDF prospecto:', e)
      } finally {
        if (!success) summaryAutoPdfLockRef.current = false
      }
    }

    void run()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- una pasada al cumplir datos; idempotencia en API
  }, [isConfirmed, summaryDataReadyForPdf])

  // Empuja el monto al dataLayer al renderizar el resumen para que GTM nunca lea
  // undefined (criterio: "DLV - monto" definido al cargar la pantalla de abono).
  // Baseline = abono (la opción destacada). Los botones Pagar / Descargar Cotización
  // ajustan el monto al TOTAL en su onPointerDown, justo antes del clic.
  useEffect(() => {
    if (payPrice > 0) pushDataLayerMonto(depositAmount(payPrice))
  }, [payPrice])

  const applyCoupon = async () => {
    const code = couponInput.trim()
    if (!code || couponBusy) return
    if (!personalInfo?.email) {
      setCouponError('Escribe tu correo en tus datos antes de aplicar un código.')
      return
    }
    setCouponBusy(true)
    setCouponError('')
    try {
      const res = await fetch('/api/quote/coupon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, quoteId: getQuoteId(), email: personalInfo.email, price: estimatedPrice }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.coupon) throw new Error(data?.error || 'No pudimos revisar el código.')
      setCoupon(data.coupon)
      trackEvent('coupon_applied', { coupon: data.coupon.code, value: data.coupon.discount, currency: 'CLP' })
    } catch (error) {
      setCoupon(null)
      setCouponError(error instanceof Error ? error.message : 'No pudimos revisar el código.')
    } finally {
      setCouponBusy(false)
    }
  }

  // Código que llegó por el link de un recomendador: se aplica solo, una vez, cuando ya hay
  // precio y correo. Si no corresponde (por ejemplo, ya es cliente), se ve el motivo.
  useEffect(() => {
    if (autoAppliedRef.current || coupon || !couponInput || !(estimatedPrice > 0) || !personalInfo?.email) return
    let fromLink = ''
    try {
      fromLink = localStorage.getItem('yme_codigo') || ''
    } catch {}
    if (!fromLink || fromLink !== couponInput) return
    autoAppliedRef.current = true
    applyCoupon()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estimatedPrice, personalInfo?.email, couponInput, coupon])

  // Pago EN LA PÁGINA. Reutiliza el mismo quoteId (un solo booking) y delega en
  // /api/quote/checkout, que crea/reutiliza la pre-reserva y genera la orden Flow.
  const handleConfirmReservation = async (paymentType: 'completo' | 'mitad') => {
    if (fechaPasada) {
      toast.error('La fecha de tu mudanza ya pasó. Vuelve a «Fecha y Hora» y elige otra.')
      return
    }
    if (!acceptedPolicies) {
      setPoliciesError(true)
      toast.error('Para reservar debes aceptar los Términos y Condiciones, las Políticas de Garantía y la Política de Privacidad.')
      policiesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }
    setIsSubmitting(true)
    trackEvent(paymentType === 'completo' ? 'click_pagar_100' : 'click_abonar_50', {
      value: paymentType === 'completo'
        ? Math.round(payPrice * 0.95)
        : depositAmount(payPrice),
      currency: 'CLP',
    })

    try {
      // Guardar como prospecto antes de procesar el pago
      if (!prospectSavedRef.current) {
        await saveProspect('checkout_initiated')
      }

      const quoteId = getQuoteId()
      const finalPrice = paymentType === 'completo'
        ? Math.round(payPrice * 0.95) // 100% con 5% de descuento
        : depositAmount(payPrice) // abono: 50%, mínimo $30.000

      const response = await fetch('/api/quote/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quoteId,
          paymentType,
          policiesAccepted: acceptedPolicies,
          ...buildQuotePayload(),
          // El precio de lista va en el payload; el servidor descuenta el cupón.
          ...(coupon ? { couponCode: coupon.code } : {}),
        }),
      })

      const data = await response.json().catch(() => ({}))
      if (!response.ok || !data.paymentUrl) {
        throw new Error(data?.error || 'Error al crear la orden de pago')
      }

      // Redirigir al usuario a Flow para completar el pago
      toast.success('Redirigiendo a la pasarela de pago segura...')

      // Tracking: InitiateCheckout
      trackEvent('InitiateCheckout', {
        value: finalPrice,
        currency: 'CLP',
        content_ids: [quoteId],
      })

      // Esperar un momento para que el usuario vea el mensaje
      setTimeout(() => {
        window.location.href = data.paymentUrl
      }, 1000)

    } catch (error) {
      console.error('Error confirming reservation:', error)
      toast.error(error instanceof Error ? error.message : 'Error al confirmar la reserva')
      setIsSubmitting(false)
      return
    }
  }

  if (isConfirmed) {
    return (
      <div className="max-w-2xl mx-auto text-center animate-slide-up">
        <Card variant="elevated" className="py-12">
          <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle className="w-12 h-12 text-green-600" />
          </div>
          <h2 className="text-3xl font-bold text-gray-900 mb-4">¡Reserva Confirmada!</h2>
          <p className="text-lg text-gray-600 mb-8">
            Tu solicitud de cotización ha sido enviada exitosamente.
          </p>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mb-8 text-left">
            <h3 className="font-semibold mb-3">📧 ¿Qué sigue?</h3>
            <ul className="space-y-2 text-sm text-gray-700">
              <li>✅ Recibirás un correo con la cotización detallada</li>
              <li>✅ Te contactaremos vía WhatsApp para confirmar detalles</li>
              <li>✅ Un ejecutivo te llamará en las próximas 24 horas</li>
              <li>✅ Podrás realizar el pago y confirmar tu reserva</li>
            </ul>
          </div>

          <div className="space-y-3">
            <Button onClick={handleSendQuote} isLoading={isSendingQuote} variant="secondary" className="w-full" size="lg">
              <Send className="w-5 h-5 mr-2" />
              Enviarme la cotización por correo
            </Button>
            <Button onClick={onReset} variant="ghost" className="w-full" size="lg">
              Nueva Cotización
            </Button>
          </div>
        </Card>
      </div>
    )
  }

  // Abono: la mitad, con un mínimo de $30.000 aunque pase del 50% (servicios chicos).
  const abono50 = depositAmount(payPrice)
  const isHalf = abono50 === Math.round(payPrice * 0.5)
  const pago100 = Math.round(payPrice * 0.95)
  const descuento100 = Math.round(payPrice * 0.05)

  // Bloque de precio reutilizado (desglose flexible + facturación empresa)
  const PriceBlock = (
    <Card variant="elevated" className="rounded-2xl border border-gray-200 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3 flex items-center gap-1.5">
        <DollarSign className="w-4 h-4 text-primary-600" />
        Precio estimado
      </p>
      {isFlexible ? (
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-600">Precio base:</span>
            <span className="text-base font-semibold text-gray-500 line-through">
              {formatCurrency(Math.round(estimatedPrice / 0.9))}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm font-semibold text-green-600">Descuento por flexibilidad:</span>
            <span className="text-base font-semibold text-green-600">-10%</span>
          </div>
          <div className="border-t border-gray-200 pt-3 flex justify-between items-end">
            <span className="text-sm text-gray-600">Total:</span>
            <span className="text-3xl font-extrabold text-gray-900">{formatCurrency(estimatedPrice)}</span>
          </div>
          <p className="text-xs text-green-600 font-semibold text-right">
            ¡Ahorraste {formatCurrency(Math.round(estimatedPrice / 0.9) - estimatedPrice)}!
          </p>
        </div>
      ) : (
        <div className="flex items-end justify-between">
          <span className="text-sm text-gray-600">Total:</span>
          <span className="text-3xl font-extrabold text-gray-900">{formatCurrency(estimatedPrice)}</span>
        </div>
      )}
      {coupon && (
        <div className="mt-3 space-y-1 border-t border-gray-200 pt-3">
          <div className="flex justify-between items-center text-sm font-semibold text-green-700">
            <span>Código {coupon.code}:</span>
            <span>−{formatCurrency(coupon.discount)}</span>
          </div>
          <div className="flex justify-between items-end">
            <span className="text-sm text-gray-600">Total con descuento:</span>
            <span className="text-3xl font-extrabold text-gray-900">{formatCurrency(coupon.finalPrice)}</span>
          </div>
        </div>
      )}
      {personalInfo?.isCompany && (
        <p className="text-xs text-gray-500 mt-1 text-right">IVA incluido</p>
      )}
      <div className="mt-4 border-t border-gray-200 pt-3">
        {coupon ? (
          <button
            type="button"
            onClick={() => {
              setCoupon(null)
              setCouponInput('')
            }}
            className="text-xs font-medium text-gray-500 underline"
          >
            Quitar código
          </button>
        ) : (
          <>
            <label htmlFor="coupon-code" className="block text-xs font-semibold text-gray-700 mb-1">
              ¿Tienes un código de descuento?
            </label>
            <div className="flex gap-2">
              <input
                id="coupon-code"
                value={couponInput}
                onChange={(e) => {
                  setCouponInput(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20))
                  setCouponError('')
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') applyCoupon()
                }}
                placeholder="Ej. OCTUBRE"
                className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm uppercase"
              />
              <Button type="button" variant="outline" size="sm" onClick={applyCoupon} isLoading={couponBusy} disabled={!couponInput.trim()}>
                Aplicar
              </Button>
            </div>
            {couponError && <p className="mt-1 text-xs text-red-600">{couponError}</p>}
          </>
        )}
      </div>
      <p className="text-[11px] text-gray-400 mt-3 text-center">
        Precio final estimado según los datos ingresados.
      </p>

      {personalInfo?.isCompany && (
        <div className="mt-4 pt-4 border-t border-gray-200">
          <div className="bg-blue-50 rounded-lg p-3 text-xs text-blue-800">
            <p className="font-bold text-blue-900 mb-1">📄 Con factura</p>
            <p className="font-semibold">Razón Social:</p>
            <p className="mb-1">{personalInfo.companyName}</p>
            <p className="font-semibold">RUT:</p>
            <p>{personalInfo.companyRut}</p>
          </div>
        </div>
      )}
    </Card>
  )

  return (
    <div className="max-w-5xl mx-auto animate-slide-up">
      {/* Header de cierre */}
      <div className="mb-6 text-center">
        <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-2">Reserva tu mudanza ahora</h2>
        <p className="text-gray-600">
          Tu precio está confirmado. Completa tu reserva en menos de 1 minuto.
        </p>
        <div className="mt-3 inline-flex items-center gap-2 bg-orange-50 border border-orange-200 text-orange-800 text-sm font-medium rounded-full px-4 py-1.5">
          <Clock className="w-4 h-4 shrink-0" />
          Tu fecha aún puede ocuparse. Abona ahora para asegurar tu cupo.
        </div>
      </div>

      <div className="flex flex-col lg:grid lg:grid-cols-3 gap-6">
        {/* COLUMNA DE CONVERSIÓN — primera en mobile, derecha en desktop */}
        <div className="order-1 lg:order-2 lg:col-span-1">
          <div className="lg:sticky lg:top-24 space-y-4">
            {/* 1. Precio */}
            {PriceBlock}

            {/* Aceptación única: obligatoria para pagar y para recibir la cotización por correo */}
            <label
              ref={policiesRef}
              className={`flex items-start gap-2.5 cursor-pointer select-none rounded-xl border bg-white px-4 py-3 ${
                policiesError && !acceptedPolicies ? 'border-red-400 ring-2 ring-red-200' : 'border-gray-200'
              }`}
            >
              <input
                type="checkbox"
                checked={acceptedPolicies}
                onChange={(e) => {
                  setAcceptedPolicies(e.target.checked)
                  if (e.target.checked) setPoliciesError(false)
                }}
                className="mt-0.5 h-4 w-4 flex-shrink-0 rounded border-gray-300 text-primary-600 focus:ring-primary-500 cursor-pointer"
              />
              <span className="text-sm text-gray-700 leading-relaxed">
                Acepto los{' '}
                <a
                  href="/terminos-y-condiciones"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-primary-600 underline hover:text-primary-700"
                >
                  Términos y Condiciones
                </a>
                , las{' '}
                <a
                  href="/politicas-de-garantia"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-primary-600 underline hover:text-primary-700"
                >
                  Políticas de Garantía
                </a>{' '}
                y la{' '}
                <a
                  href="/politica-de-privacidad"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-primary-600 underline hover:text-primary-700"
                >
                  Política de Privacidad
                </a>{' '}
                de Yo me Encargo.
              </span>
            </label>
            {policiesError && !acceptedPolicies && (
              <p className="-mt-2 px-1 text-xs font-medium text-red-600">
                Marca la casilla para reservar o recibir la cotización por correo.
              </p>
            )}

            {/* 2. Abonar 50% — CTA dominante */}
            <Card variant="elevated" className="rounded-2xl border-2 border-[#8CC63F] bg-[#F2FBE9] shadow-lg">
              <div className="text-center">
                <span className="inline-block bg-[#8CC63F] text-[#0E1A05] text-[11px] font-bold uppercase tracking-wide px-3 py-1 rounded-full mb-3">
                  ⭐ Opción más elegida
                </span>
                <h3 className="text-xl font-bold text-gray-900">{isHalf ? 'Reserva con el 50%' : 'Reserva con un abono'}</h3>
                <p className="text-sm text-gray-600 mt-1 mb-4">
                  {isHalf ? 'Asegura tu fecha abonando solo la mitad ahora.' : 'Asegura tu fecha con el abono mínimo.'} El resto lo pagas al finalizar el traslado.
                </p>
                <p className="text-4xl font-extrabold text-[#3F6212] leading-none">
                  {formatCurrency(abono50)}
                </p>
                <p className="text-xs text-gray-500 mt-1 mb-4">
                  + {formatCurrency(payPrice - abono50)} al finalizar el traslado
                </p>
                <Button
                  onPointerDown={() => pushDataLayerMonto(abono50)}
                  onClick={() => handleConfirmReservation('mitad')}
                  isLoading={isSubmitting}
                  size="lg"
                  className="w-full bg-[#8CC63F] hover:bg-[#6FA52E] text-[#0E1A05] font-bold shadow-md"
                >
                  <CheckCircle className="w-5 h-5 mr-2" />
                  {isHalf ? 'Abonar 50% y asegurar mi cupo' : 'Abonar y asegurar mi cupo'}
                </Button>
                <p className="text-xs text-gray-500 mt-2">Confirmación inmediata por correo.</p>
                <p className="text-xs text-gray-700 mt-3 bg-white/70 border border-[#cfe6a8] rounded-lg px-3 py-2">
                  Tu fecha y horario se confirman solo al realizar el abono.
                </p>
              </div>
            </Card>

            {/* 3. Pagar 100% — opción secundaria */}
            <Card className="rounded-2xl border border-gray-200">
              <div className="text-center">
                <p className="text-sm font-semibold text-gray-700">¿Prefieres pagar todo ahora?</p>
                <p className="text-xs text-green-700 font-medium mt-0.5 mb-2">
                  Obtén 5% de descuento pagando el total.
                </p>
                <p className="text-2xl font-bold text-gray-900 leading-none">{formatCurrency(pago100)}</p>
                <p className="text-[11px] text-gray-500 mb-3">Ahorras {formatCurrency(descuento100)}</p>
                <Button
                  onPointerDown={() => pushDataLayerMonto(pago100)}
                  onClick={() => handleConfirmReservation('completo')}
                  isLoading={isSubmitting}
                  variant="outline"
                  size="lg"
                  className="w-full"
                >
                  Pagar 100% con descuento
                </Button>
                <p className="text-xs text-gray-500 mt-2">Pago seguro procesado por Webpay.</p>
              </div>
            </Card>

            {/* 4. Mensaje de cuotas */}
            <div className="flex items-start gap-2 text-xs text-gray-600 px-1">
              <CreditCard className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
              <span>Puedes pagar con débito, crédito o en cuotas según tu medio de pago.</span>
            </div>

            {/* 5. Enviar cotización por correo (para indecisos) */}
            <Card className="rounded-2xl border border-blue-200 bg-gradient-to-br from-blue-50 to-white">
              <p className="text-sm font-semibold text-gray-800 text-center mb-1">
                ¿Prefieres decidir con calma?
              </p>
              <p className="text-xs text-gray-500 text-center mb-3">
                Te enviamos la cotización detallada y el enlace de pago para revisarlo cuando quieras.
              </p>

              <Button
                onPointerDown={() => pushDataLayerMonto(estimatedPrice)}
                onClick={handleSendQuote}
                isLoading={isSendingQuote}
                variant="outline"
                className="w-full border-2 border-blue-500 text-blue-700 hover:bg-blue-50"
                size="lg"
              >
                <Send className="w-5 h-5 mr-2" />
                Enviarme la cotización por correo
              </Button>
            </Card>

            {/* 6. Garantía / confianza */}
            <Card className="rounded-2xl border border-gray-200">
              <h3 className="text-base font-bold text-gray-900 mb-3 flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-[#6FA52E]" />
                Compra protegida
              </h3>
              <ul className="space-y-2 text-sm text-gray-700">
                {[
                  'Comprobante de reserva inmediato',
                  'Precio fijo sin sorpresas',
                  'Carga protegida durante el traslado',
                ].map((g) => (
                  <li key={g} className="flex gap-2">
                    <CheckCircle className="w-4 h-4 text-green-600 mt-0.5 shrink-0" />
                    <span>{g}</span>
                  </li>
                ))}
                {/* Antes decía «sujeta a políticas de garantía» sin que esas políticas
                    existieran en el sitio: ahora lleva a ellas, en otra pestaña para no
                    perder la cotización. */}
                <li className="flex gap-2">
                  <CheckCircle className="w-4 h-4 text-green-600 mt-0.5 shrink-0" />
                  <span>
                    Devolución disponible según nuestras{' '}
                    <a
                      href="/politicas-de-garantia"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-primary-600 underline hover:text-primary-700"
                    >
                      políticas de garantía
                    </a>
                  </span>
                </li>
              </ul>
            </Card>

            {/* 7. Qué ocurre después del pago */}
            <Card className="rounded-2xl border border-gray-200 bg-blue-50/40">
              <h3 className="text-base font-bold text-gray-900 mb-3">¿Qué pasa después de pagar?</h3>
              <ol className="space-y-2.5">
                {[
                  'Confirmamos tu reserva',
                  'Recibes comprobante por correo',
                  'Coordinamos detalles por WhatsApp',
                  'Realizamos tu mudanza en la fecha agendada',
                ].map((step, i) => (
                  <li key={step} className="flex gap-3 items-start">
                    <span className="w-6 h-6 rounded-full bg-primary-600 text-white text-xs font-bold flex items-center justify-center shrink-0">
                      {i + 1}
                    </span>
                    <span className="text-sm text-gray-700">{step}</span>
                  </li>
                ))}
              </ol>
            </Card>
          </div>
        </div>

        {/* COLUMNA DE RESUMEN — segunda en mobile, izquierda en desktop (menor peso visual) */}
        <div className="order-2 lg:order-1 lg:col-span-2 space-y-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
            Resumen de tu cotización
          </p>

          {/* Datos Personales */}
          <Card>
            <h3 className="font-semibold text-base mb-4 flex items-center gap-2 text-gray-700">
              <Mail className="w-5 h-5 text-primary-600" />
              Datos de Contacto
            </h3>
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <span className="text-sm text-gray-500">Nombre:</span>
                <p className="font-semibold">{personalInfo?.name}</p>
              </div>
              <div>
                <span className="text-sm text-gray-500">Email:</span>
                <p className="font-semibold">{personalInfo?.email}</p>
              </div>
              <div>
                <span className="text-sm text-gray-500">Teléfono:</span>
                <p className="font-semibold">{personalInfo?.phone}</p>
              </div>
              {personalInfo?.isCompany && (
                <>
                  <div>
                    <span className="text-sm text-gray-500">Razón Social:</span>
                    <p className="font-semibold">{personalInfo?.companyName}</p>
                  </div>
                  <div>
                    <span className="text-sm text-gray-500">RUT:</span>
                    <p className="font-semibold">{personalInfo?.companyRut}</p>
                    <span className="text-xs text-green-600">✓ Con factura</span>
                  </div>
                </>
              )}
            </div>
          </Card>

          {/* Fecha y Hora */}
          <Card>
            <h3 className="font-semibold text-base mb-4 flex items-center gap-2 text-gray-700">
              <Calendar className="w-5 h-5 text-primary-600" />
              Fecha y Hora
            </h3>
            <p className="text-gray-700">
              📅 {dateTime && formatDate(new Date(dateTime))}
            </p>
            <p className="text-gray-700">
              🕐 {dateTime && formatTime(new Date(dateTime))}
            </p>
            {fechaPasada && (
              <p className="mt-2 text-sm font-semibold text-red-600">
                Esta fecha ya pasó. Vuelve al paso «Fecha y Hora» y elige otra.
              </p>
            )}
            {isFlexible && (
              <p className="text-green-600 mt-2 text-sm font-semibold">
                ✅ Con descuento por flexibilidad (-10%)
              </p>
            )}
          </Card>

          {/* Direcciones */}
          <Card>
            <h3 className="font-semibold text-base mb-4 flex items-center gap-2 text-gray-700">
              <MapPin className="w-5 h-5 text-primary-600" />
              Direcciones
            </h3>
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <span className="text-sm text-gray-500 block mb-1">🔵 Origen:</span>
                <p className="font-semibold">
                  {origin.address?.street} {origin.address?.number}
                </p>
                <p className="text-sm text-gray-600">{origin.address?.commune}</p>
                <p className="text-sm text-gray-600">
                  {origin.details?.propertyType} - Piso {origin.details?.floor}
                  {origin.details?.hasElevator ? ' (con ascensor)' : ' (sin ascensor)'}
                </p>
              </div>
              {(stops || []).length > 0 && (
                <div className="md:col-span-2">
                  <span className="mb-1 block text-sm text-gray-500">
                    🟡 Paradas en el camino:
                  </span>
                  <ol className="space-y-1">
                    {stops.map((parada, i) => (
                      <li key={i} className="text-sm">
                        <span className="font-semibold">
                          {i + 1}. {formatStopAddress(parada)}
                        </span>
                        {parada.note && (
                          <span className="text-gray-600"> — {parada.note}</span>
                        )}
                      </li>
                    ))}
                  </ol>
                </div>
              )}
              <div>
                <span className="text-sm text-gray-500 block mb-1">🟢 Destino:</span>
                <p className="font-semibold">
                  {destination.address?.street} {destination.address?.number}
                </p>
                <p className="text-sm text-gray-600">{destination.address?.commune}</p>
                <p className="text-sm text-gray-600">
                  {destination.details?.propertyType} - Piso {destination.details?.floor}
                  {destination.details?.hasElevator ? ' (con ascensor)' : ' (sin ascensor)'}
                </p>
              </div>
            </div>

            {/* Distancia calculada */}
            {totalDistance > 0 && (
              <div className="mt-4 pt-4 border-t">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">📏 Distancia estimada:</span>
                  <span className="font-semibold text-primary-600">{formatDistanceKm(totalDistance)}</span>
                </div>
                {totalDistance > freeKilometers && (
                  <p className="text-xs text-gray-500 mt-1">
                    Primeros {freeKilometers} km incluidos.
                    Se cobran {totalDistance - freeKilometers} km adicionales.
                  </p>
                )}
                {totalDistance <= freeKilometers && (
                  <p className="text-xs text-green-600 mt-1">
                    ✅ Distancia incluida en el precio base (hasta {freeKilometers} km gratis)
                  </p>
                )}
              </div>
            )}
          </Card>

          {/* Items */}
          <Card>
            <h3 className="font-semibold text-base mb-4 flex items-center gap-2 text-gray-700">
              <Package className="w-5 h-5 text-primary-600" />
              Items a Transportar ({items.reduce((sum, item) => sum + item.quantity, 0)} items)
            </h3>
            <div className="max-h-48 overflow-y-auto space-y-2">
              {items.map((item) => {
                const hasPackaging = item.packaging && item.packaging.type !== 'none'

                return (
                  <div
                    key={item.id}
                    className="p-2 bg-gray-50 rounded"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm">
                        {item.name} <span className="text-gray-500">x{item.quantity}</span>
                      </span>
                      <span className="text-xs text-gray-500">
                        {parseFloat((item.volume * item.quantity).toFixed(2))} m³
                      </span>
                    </div>
                    {hasPackaging && (
                      <div className="mt-1 text-xs text-green-700">
                        📦 Con embalaje especial
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            <div className="mt-4 pt-4 border-t grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
              <div>
                <p className="text-sm text-gray-500">Volumen Total</p>
                <p className="font-bold text-lg">{parseFloat(totalVolume.toFixed(2))} m³</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Peso Total</p>
                <p className="font-bold text-lg">{totalWeight} kg</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Equipo</p>
                <p className="font-bold text-lg">👷</p>
                <p className="text-xs text-gray-600">
                  {totalCrew} {totalCrew === 1 ? 'persona' : 'personas'}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Vehículo</p>
                <p className="font-bold text-lg">🚚</p>
                <p className="text-xs text-gray-600">{recommendedVehicle}</p>
              </div>
            </div>

            {/* Por qué va esa cantidad de gente: sin esta línea el precio sube y el
                cliente no tiene forma de saber de dónde salió. */}
            {totalCrew > 1 && (
              <p className="mt-3 text-xs text-gray-500">
                {requiredCrew > 1 && (
                  <>
                    Tu carga incluye un artículo pesado, así que el traslado va con{' '}
                    <strong>{requiredCrew} personas</strong> por seguridad.
                  </>
                )}
                {totalCrew > requiredCrew && (
                  <>
                    {' '}
                    Sumaste {totalCrew - requiredCrew}{' '}
                    {totalCrew - requiredCrew === 1 ? 'ayudante' : 'ayudantes'} para agilizar
                    el trabajo.
                  </>
                )}
              </p>
            )}
          </Card>

          {/* Embalaje Especial */}
          {items.some(item => item.packaging && item.packaging.type !== 'none') && (() => {
            // Calcular costo total: volumen de items con embalaje × precio por m³
            const packagingCost = items
              .filter(item => item.packaging && item.packaging.type !== 'none')
              .reduce((sum, item) => {
                const itemVolume = item.volume * item.quantity
                const itemPackagingCost = item.packaging?.pricePerUnit || 0
                return sum + (itemPackagingCost * itemVolume)
              }, 0)

            // Calcular volumen total con embalaje
            const volumeWithPackaging = items
              .filter(item => item.packaging && item.packaging.type !== 'none')
              .reduce((sum, item) => sum + (item.volume * item.quantity), 0)

            return (
              <Card>
                <h3 className="font-semibold text-base mb-4 text-gray-700">📦 Embalaje Especial</h3>

                {/* Info importante */}
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
                  <p className="text-xs text-blue-800">
                    <strong>💡 Nota:</strong> El embalaje especial se cobra multiplicando el precio por el volumen de los items que tienen embalaje seleccionado ({parseFloat(volumeWithPackaging.toFixed(1))} m³).
                  </p>
                </div>

                {/* Items con embalaje */}
                <div className="space-y-3 mb-4">
                  {items
                    .filter(item => item.packaging && item.packaging.type !== 'none')
                    .map((item) => {
                      const itemVolume = item.volume * item.quantity
                      const itemPackagingCost = item.packaging?.pricePerUnit || 0
                      const itemTotal = itemPackagingCost * itemVolume

                      return (
                        <div key={`packaging-${item.id}`} className="flex justify-between text-sm bg-gray-50 p-2 rounded">
                          <div>
                            <span className="font-medium">{item.name}</span>
                            <span className="text-gray-500"> ×{item.quantity}</span>
                            <div className="text-xs text-gray-500">
                              {parseFloat(itemVolume.toFixed(2))} m³ × ${itemPackagingCost.toLocaleString()}/m³
                            </div>
                          </div>
                          <span className="font-semibold">
                            ${itemTotal.toLocaleString()}
                          </span>
                        </div>
                      )
                    })}
                </div>

                {/* Total */}
                <div className="mt-4 pt-4 border-t flex justify-between font-bold text-green-700">
                  <span>Total Embalaje Especial:</span>
                  <span>${packagingCost.toLocaleString()}</span>
                </div>
              </Card>
            )
          })()}

          {/* Servicios Adicionales */}
          {(() => {
            // Recargo automático por pasarse del volumen de un camión. No lo elige el
            // cliente, así que se muestra igual que un cargo más: si el precio sube, se
            // tiene que ver por qué.
            const overCapacity = overCapacitySurcharge(totalVolume, {
              overCapacityThresholdM3: pricingConfig.services.overCapacityThresholdM3,
              overCapacityPrice: pricingConfig.services.overCapacityPrice,
            })
            const fridgeCharged = additionalServices.fridgeDisassembly && hasFridge(items)
            return (additionalServices.disassembly ||
            additionalServices.assembly ||
            additionalServices.packing ||
            additionalServices.unpacking ||
            fridgeCharged ||
            additionalServices.priority ||
            additionalServices.stairsCarry ||
            overCapacity > 0 ||
            additionalServices.observations) && (
              <Card>
                <h3 className="font-semibold text-base mb-4 text-gray-700">Servicios Adicionales</h3>
                <div className="space-y-2">
                  {additionalServices.disassembly && (
                    <div className="flex justify-between text-sm">
                      <span>✓ Desarme de muebles</span>
                      <span className="font-semibold">${pricingConfig.services.disassembly.toLocaleString()}</span>
                    </div>
                  )}
                  {additionalServices.assembly && (
                    <div className="flex justify-between text-sm">
                      <span>✓ Armado de muebles</span>
                      <span className="font-semibold">${pricingConfig.services.assembly.toLocaleString()}</span>
                    </div>
                  )}
                  {additionalServices.packing && (
                    <div className="flex justify-between items-center text-sm">
                      <div>
                        <span>✓ Armado de Cajas</span>
                        <p className="text-xs text-blue-600 mt-0.5">💬 Para contratar este servicio, habla con un ejecutivo</p>
                      </div>
                    </div>
                  )}
                  {additionalServices.unpacking && (
                    <div className="flex justify-between items-center text-sm">
                      <div>
                        <span>✓ Desembalaje</span>
                        <p className="text-xs text-blue-600 mt-0.5">💬 Para contratar este servicio, habla con un ejecutivo</p>
                      </div>
                    </div>
                  )}
                  {fridgeCharged && (
                    <div className="flex justify-between text-sm">
                      <span>✓ Desarmado de refrigerador</span>
                      <span className="font-semibold">${pricingConfig.services.fridgeDisassembly.toLocaleString()}</span>
                    </div>
                  )}
                  {additionalServices.priority && (
                    <div className="flex justify-between text-sm">
                      <span>✓ Priority — agenda libre</span>
                      <span className="font-semibold">${pricingConfig.services.priority.toLocaleString()}</span>
                    </div>
                  )}
                  {additionalServices.stairsCarry && (
                    <div className="text-sm">
                      <span>✓ Muebles grandes por la escalera</span>
                      <p className="mt-0.5 text-xs text-gray-500">Avisado al equipo: no caben en el ascensor.</p>
                    </div>
                  )}
                  {overCapacity > 0 && (
                    <div className="flex justify-between items-start text-sm">
                      <div>
                        <span>Segundo camión</span>
                        <p className="mt-0.5 text-xs text-gray-500">
                          Tu mudanza son {totalVolume.toFixed(1)} m³ y en un camión entran{' '}
                          {pricingConfig.services.overCapacityThresholdM3} m³, así que va en{' '}
                          {trucksNeeded(totalVolume, pricingConfig.services.overCapacityThresholdM3)}{' '}
                          viajes.
                        </p>
                      </div>
                      <span className="font-semibold whitespace-nowrap">${overCapacity.toLocaleString()}</span>
                    </div>
                  )}
                </div>
                {additionalServices.observations && (
                  <div className="mt-4 pt-4 border-t">
                    <p className="text-sm text-gray-500 mb-1">Observaciones:</p>
                    <p className="text-sm text-gray-700">{additionalServices.observations}</p>
                  </div>
                )}
              </Card>
            )
          })()}
        </div>
      </div>

      {/* Editar cotización — link discreto al final */}
      <div className="mt-8 text-center">
        <button
          type="button"
          onClick={() => {
            trackEvent('click_editar_cotizacion')
            onPrevious()
          }}
          disabled={isSubmitting}
          className="text-sm text-gray-500 hover:text-gray-700 underline underline-offset-2 disabled:opacity-50"
        >
          ¿Necesitas cambiar algún dato? Editar cotización
        </button>
      </div>
    </div>
  )
}
