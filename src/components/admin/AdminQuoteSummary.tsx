'use client'

import { useEffect, useRef, useState } from 'react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import toast from 'react-hot-toast'
import { CheckCircle, Download, Save, Send } from 'lucide-react'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import { useQuoteStore } from '@/store/quoteStore'
import { getPricingConfig } from '@/lib/pricingService'
import { generateQuotePDF } from '@/lib/pdfGenerator'
import { buildQuoteAddress, buildQuoteProspectBody } from '@/lib/quoteProspectPayload'
import { clearQuoteEdit, getQuoteEdit } from './quoteEditSession'

interface AdminQuoteSummaryProps {
  onPrevious: () => void
  /** Vuelve al primer paso con el cotizador vacío. */
  onStartOver: () => void
  onGoToProspects: () => void
}

/** Más de esto sobre el calculado pide confirmar: protege contra un cero de más o de menos. */
const AJUSTE_GRANDE = 0.3

const clp = (n: number) => `$${Math.round(n).toLocaleString('es-CL')}`

/**
 * Id ESTABLE de la cotización en curso, igual que en la web: sobrevive a volver atrás
 * para corregir un paso o a recargar la página. Si cambiara en cada intento, un envío que
 * alcanzó a crear la pre-reserva y falló en el correo dejaría una segunda pre-reserva del
 * mismo cliente al reintentar.
 */
const QUOTE_ID_KEY = 'yme_admin_quote_id'
export function currentAdminQuoteId(): string {
  if (typeof window === 'undefined') return `Q-${Date.now()}`
  const stored = sessionStorage.getItem(QUOTE_ID_KEY)
  if (stored) return stored
  const id = `Q-${Date.now()}`
  sessionStorage.setItem(QUOTE_ID_KEY, id)
  return id
}
export function clearAdminQuoteId() {
  if (typeof window !== 'undefined') sessionStorage.removeItem(QUOTE_ID_KEY)
}

/**
 * Último paso del cotizador interno. Reemplaza al resumen web, que no sirve acá: dispara
 * eventos de conversión de Google Ads/Meta, guarda la cotización con la atribución de la
 * cookie del navegador y ofrece pagar. Los pasos anteriores son los mismos componentes del
 * cotizador web, con el mismo store, así que el cálculo es exactamente el mismo.
 *
 * Envía en tres pasos que se pueden reintentar por separado: guardar la cotización (precio
 * calculado + final en una sola escritura), subir el PDF y mandar el correo. Si uno falla,
 * el reintento sigue desde ahí sin volver a crear nada.
 */
export default function AdminQuoteSummary({
  onPrevious,
  onStartOver,
  onGoToProspects,
}: AdminQuoteSummaryProps) {
  const state = useQuoteStore()
  const { personalInfo, dateTime, origin, destination, stops, items, calculateTotals } = state

  const [calculating, setCalculating] = useState(true)
  const [finalPrice, setFinalPrice] = useState('')
  const finalEditedRef = useRef(false)
  const [note, setNote] = useState('')
  const [overCapacity, setOverCapacity] = useState({ overCapacityThresholdM3: 0, overCapacityPrice: 0 })

  const [working, setWorking] = useState<null | 'saving' | 'uploading' | 'sending'>(null)
  const [done, setDone] = useState<null | { calculated: number; final: number; email: string }>(null)
  // Cotización existente que se está editando (Prospectos → «Editar cotización»), o null.
  const [edit] = useState(() => getQuoteEdit())
  // Guardada sin enviar (o cambios guardados de una cotización editada).
  const [saved, setSaved] = useState<null | { final: number; draft: boolean }>(null)
  // Una cotización con reserva ya pagada no vuelve a mandar links de pago.
  const canSend = !edit?.booking?.paid
  // Avance de un envío, para reintentar desde el paso que falló.
  const progressRef = useRef<{ quoteId: string; prospectId?: string; pdfUploaded?: boolean }>({
    quoteId: currentAdminQuoteId(),
  })

  // Si después de un intento fallido se cambia el precio o la nota, lo guardado y el PDF
  // subido ya no sirven: el reintento tiene que volver a guardar y regenerar el PDF.
  useEffect(() => {
    progressRef.current = { quoteId: progressRef.current.quoteId }
  }, [finalPrice, note])

  useEffect(() => {
    let vigente = true
    ;(async () => {
      setCalculating(true)
      try {
        const pricing = await getPricingConfig()
        if (vigente) {
          setOverCapacity({
            overCapacityThresholdM3: pricing.additionalServices.overCapacityThresholdM3,
            overCapacityPrice: pricing.additionalServices.overCapacityPrice,
          })
        }
        await calculateTotals()
      } finally {
        if (!vigente) return
        setCalculating(false)
        // El precio final arranca en el calculado. Si la secretaria ya lo había tocado,
        // no se le pisa.
        if (!finalEditedRef.current) {
          setFinalPrice(String(useQuoteStore.getState().estimatedPrice || ''))
        }
      }
    })()
    return () => {
      vigente = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const calculated = state.estimatedPrice
  const final = Math.round(Number(finalPrice))
  const finalValido = finalPrice.trim() !== '' && Number.isFinite(final) && final > 0
  const diferencia = finalValido && calculated > 0 ? final - calculated : 0
  const porcentaje = calculated > 0 ? diferencia / calculated : 0

  const descargarPdf = async () => {
    if (!finalValido) {
      toast.error('Ingresa un precio final válido')
      return
    }
    await generateQuotePDF({ download: true, priceOverride: final })
  }

  const guardarYEnviar = async () => {
    if (calculating || !(calculated > 0)) {
      toast.error('Espera a que termine el cálculo del precio')
      return
    }
    if (!finalValido) {
      toast.error('Ingresa un precio final válido')
      return
    }
    if (Math.abs(porcentaje) > AJUSTE_GRANDE) {
      const ok = confirm(
        `El precio final (${clp(final)}) está ${Math.round(Math.abs(porcentaje) * 100)}% ${
          diferencia > 0 ? 'sobre' : 'bajo'
        } el calculado (${clp(calculated)}). ¿Confirmas enviar la cotización con ${clp(final)}?`
      )
      if (!ok) return
    }

    const progreso = progressRef.current
    const email = personalInfo?.email || ''
    try {
      // 1) Guardar: calculado + final en una sola escritura.
      if (!progreso.prospectId) {
        setWorking('saving')
        const res = await fetch('/api/admin/quotes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            quote: buildQuoteProspectBody(useQuoteStore.getState(), {
              source: 'web',
              quoteId: progreso.quoteId,
              overCapacity,
            }),
            final_price: final,
            adjustment_comment: note,
            ...(edit ? { prospect_id: edit.prospectId } : {}),
          }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok || !data.prospectId) {
          throw new Error(data?.error || 'No se pudo guardar la cotización')
        }
        progreso.prospectId = data.prospectId
      }

      // 2) El mismo PDF que recibe el cliente web, con el precio final.
      if (!progreso.pdfUploaded) {
        setWorking('uploading')
        const pdf = await generateQuotePDF({ download: false, priceOverride: final })
        if (!pdf?.blob) throw new Error('No se pudo generar el PDF')
        const form = new FormData()
        form.append('pdf', pdf.blob, pdf.fileName)
        form.append('prospectId', progreso.prospectId!)
        if (email) form.append('prospectEmail', email)
        const res = await fetch('/api/prospects/upload-pdf', { method: 'POST', body: form })
        const data = await res.json().catch(() => ({}))
        if (!res.ok || data?.warning) {
          throw new Error(
            `La cotización quedó guardada, pero el PDF no se pudo subir: ${data?.error || data?.warning || res.status}. No se envió nada al cliente.`
          )
        }
        progreso.pdfUploaded = true
      }

      // 3) Enviar por la ruta de siempre. Sin precio en el cuerpo a propósito: la ruta lo
      //    lee del prospecto recién guardado, que es la única fuente del precio final.
      setWorking('sending')
      const res = await fetch('/api/admin/prospects/send-quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prospectId: progreso.prospectId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.error || 'No se pudo enviar la cotización por correo')
      }

      setDone({ calculated, final, email })
      toast.success('Cotización enviada al cliente')
    } catch (error) {
      console.error('[AdminQuoteSummary] Error:', error)
      toast.error(error instanceof Error ? error.message : 'No se pudo enviar la cotización', {
        duration: 8000,
      })
    } finally {
      setWorking(null)
    }
  }

  /**
   * «Guardar sin enviar» (nueva) o «Guardar cambios» (editando): guarda la cotización y no le
   * manda nada al cliente. Una nueva queda como borrador, sin correos automáticos hasta que se
   * envíe; una editada conserva lo que ya era (si el cliente ya la tenía, sigue su seguimiento).
   */
  const guardarSinEnviar = async () => {
    if (calculating || !(calculated > 0)) {
      toast.error('Espera a que termine el cálculo del precio')
      return
    }
    if (!finalValido) {
      toast.error('Ingresa un precio final válido')
      return
    }
    setWorking('saving')
    try {
      const res = await fetch('/api/admin/quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quote: buildQuoteProspectBody(useQuoteStore.getState(), { source: 'web', quoteId: progressRef.current.quoteId, overCapacity }),
          final_price: final,
          adjustment_comment: note,
          draft: !edit,
          ...(edit ? { prospect_id: edit.prospectId } : {}),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.prospectId) throw new Error(data?.error || 'No se pudo guardar la cotización')
      // Si después se envía, no se vuelve a guardar: sigue desde el PDF.
      progressRef.current = { quoteId: progressRef.current.quoteId, prospectId: data.prospectId }
      setSaved({ final, draft: !edit })
      toast.success(edit ? 'Cambios guardados' : 'Cotización guardada sin enviar')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo guardar la cotización', { duration: 8000 })
    } finally {
      setWorking(null)
    }
  }

  const empezarOtra = () => {
    clearQuoteEdit()
    clearAdminQuoteId()
    progressRef.current = { quoteId: currentAdminQuoteId() }
    setDone(null)
    setSaved(null)
    setNote('')
    finalEditedRef.current = false
    onStartOver()
  }

  if (done) {
    return (
      <Card className="p-8 text-center max-w-2xl mx-auto">
        <CheckCircle className="w-14 h-14 text-green-600 mx-auto mb-4" />
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Cotización enviada</h2>
        <p className="text-gray-600 mb-6">
          Le llegó a <strong>{done.email}</strong> con el PDF y los links de pago por{' '}
          <strong>{clp(done.final)}</strong>. Desde ahora sigue el mismo seguimiento por correo que
          una cotización de la web, siempre con ese precio.
        </p>
        {done.final !== done.calculated && (
          <p className="text-sm text-gray-500 mb-6">
            Precio calculado por el sistema: {clp(done.calculated)}. Queda registrado en el
            prospecto y en el log de actividad.
          </p>
        )}
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Button onClick={onGoToProspects} variant="outline">
            Ver en Prospectos
          </Button>
          <Button onClick={empezarOtra}>Nueva cotización</Button>
        </div>
      </Card>
    )
  }

  const fecha = dateTime ? format(new Date(dateTime), "EEEE d 'de' MMMM yyyy, HH:mm", { locale: es }) : '—'
  const unidades = (items || []).reduce((s, it) => s + (Number(it.quantity) || 0), 0)

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {saved && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          {saved.draft
            ? `Guardada sin enviar por ${clp(saved.final)}: queda en Prospectos como borrador y el cliente no recibe correos hasta que la envíes.`
            : `Cambios guardados: la cotización quedó en ${clp(saved.final)}. No se le envió nada al cliente.`}{' '}
          <button type="button" onClick={onGoToProspects} className="font-semibold underline">
            Ver en Prospectos
          </button>
        </div>
      )}
      <Card className="p-6">
        <h2 className="text-xl font-bold text-gray-900 mb-4">Resumen de la cotización</h2>
        <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <div>
            <dt className="text-gray-500">Cliente</dt>
            <dd className="font-medium text-gray-900">
              {personalInfo?.name} · {personalInfo?.email} · {personalInfo?.phone}
              {personalInfo?.isCompany && personalInfo?.companyName ? ` · ${personalInfo.companyName}` : ''}
            </dd>
          </div>
          <div>
            <dt className="text-gray-500">Fecha</dt>
            <dd className="font-medium text-gray-900 capitalize">{fecha}</dd>
          </div>
          <div className="md:col-span-2">
            <dt className="text-gray-500">Ruta</dt>
            <dd className="font-medium text-gray-900">
              {buildQuoteAddress(origin)} → {buildQuoteAddress(destination)}
              {Array.isArray(stops) && stops.length > 0 ? ` (${stops.length} parada${stops.length > 1 ? 's' : ''})` : ''}
            </dd>
          </div>
          <div>
            <dt className="text-gray-500">Carga</dt>
            <dd className="font-medium text-gray-900">
              {unidades} bultos · {state.totalVolume.toFixed(2)} m³ · {state.recommendedVehicle}
            </dd>
          </div>
          <div>
            <dt className="text-gray-500">Distancia</dt>
            <dd className="font-medium text-gray-900">{state.totalDistance} km</dd>
          </div>
        </dl>
      </Card>

      <Card className="p-6">
        <h2 className="text-xl font-bold text-gray-900 mb-4">Precio</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <p className="text-sm text-gray-500 mb-1">Calculado por el sistema</p>
            <p className="text-3xl font-bold text-gray-900">
              {calculating ? 'Calculando…' : clp(calculated)}
            </p>
            <p className="mt-1 text-xs text-gray-500">
              Mismo cálculo que el cotizador web. No se le muestra al cliente si lo cambias.
            </p>
            {edit?.previousPrice ? <p className="mt-1 text-xs text-gray-600">Precio que tenía la cotización: {clp(edit.previousPrice)}</p> : null}
          </div>
          <div>
            <label className="block text-sm text-gray-500 mb-1">Precio final para el cliente</label>
            <Input
              type="number"
              min="1"
              step="1"
              value={finalPrice}
              disabled={calculating}
              onChange={(e) => {
                finalEditedRef.current = true
                setFinalPrice(e.target.value)
              }}
            />
            {finalValido && calculated > 0 && diferencia !== 0 && (
              <p className={`mt-1 text-sm font-medium ${diferencia > 0 ? 'text-green-700' : 'text-orange-700'}`}>
                {diferencia > 0 ? '+' : '−'}
                {clp(Math.abs(diferencia))} ({Math.round(Math.abs(porcentaje) * 100)}%{' '}
                {diferencia > 0 ? 'sobre' : 'bajo'} el calculado)
              </p>
            )}
            <p className="mt-1 text-xs text-gray-500">
              Es el que va en el PDF, en los links de pago y en todos los correos de seguimiento.
              {personalInfo?.isCompany ? ' Empresa: igual que el calculado, con IVA incluido.' : ''}
            </p>
          </div>
        </div>

        <div className="mt-6">
          <label className="block text-sm text-gray-500 mb-1">
            Nota para el cliente <span className="text-gray-400">(opcional)</span>
          </label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
            placeholder="Ej.: precio acordado por teléfono"
          />
          <p className="mt-1 text-xs text-gray-500">
            Solo se guarda si cambiaste el precio. Si escribes algo, el cliente lo ve en el correo
            bajo «Ajuste de tu cotización»; déjala vacía si no conoce otro precio.
          </p>
        </div>
      </Card>

      {!canSend && (
        <p className="rounded-lg bg-amber-50 px-4 py-2 text-sm text-amber-800">
          Esta cotización ya tiene una reserva pagada ({edit?.booking?.code}): se guardan los artículos y el precio de la cotización, pero no se vuelven a
          mandar links de pago. El precio de la reserva se cambia en Reservas.
        </p>
      )}
      <div className="flex flex-col sm:flex-row gap-3 justify-between">
        <Button onClick={onPrevious} variant="outline" disabled={Boolean(working)}>
          ← Volver
        </Button>
        <div className="flex flex-col sm:flex-row gap-3">
          <Button
            onClick={descargarPdf}
            variant="outline"
            disabled={calculating || Boolean(working) || !finalValido}
          >
            <Download className="w-4 h-4 mr-2" />
            Ver PDF
          </Button>
          <Button onClick={guardarSinEnviar} variant="outline" disabled={calculating || Boolean(working) || !finalValido}>
            <Save className="w-4 h-4 mr-2" />
            {edit ? 'Guardar cambios' : 'Guardar sin enviar'}
          </Button>
          {canSend && (
          <Button onClick={guardarYEnviar} disabled={calculating || Boolean(working) || !finalValido}>
            <Send className="w-4 h-4 mr-2" />
            {working === 'saving'
              ? 'Guardando…'
              : working === 'uploading'
                ? 'Subiendo PDF…'
                : working === 'sending'
                  ? 'Enviando…'
                  : 'Guardar y enviar al cliente'}
          </Button>
          )}
        </div>
      </div>
    </div>
  )
}
