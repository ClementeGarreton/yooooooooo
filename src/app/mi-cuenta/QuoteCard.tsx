'use client'

import { useState } from 'react'
import type { AccountQuote } from '@/lib/customerAccount'
import type { CouponQuote } from '@/lib/couponTypes'
import { useQuoteStore } from '@/store/quoteStore'
import { clp, formatDate, formatTime, route } from './format'

type PaymentType = 'mitad' | 'completo'

/**
 * Tarjeta de una cotización con sus acciones (Módulo 1, paso 2):
 *  - Descargar PDF: el que se generó al cotizar.
 *  - Reservar (solo vigentes): elige abono 50% o pago completo con 5% de descuento, acepta
 *    las Políticas de Garantía y va a Flow. Mismas opciones y misma casilla que el
 *    resumen del cotizador web. El precio lo pone el servidor, no esta tarjeta.
 *  - Retomar: abre el cotizador con lo que la persona cargó (solo las que guardaron el
 *    estado, desde oct-2026). El precio se vuelve a calcular con los valores vigentes.
 *  - Vencida que no se puede retomar: se ofrece cotizar de nuevo.
 */
export default function QuoteCard({ quote }: { quote: AccountQuote }) {
  const [open, setOpen] = useState(false)
  const [accepted, setAccepted] = useState(false)
  const [working, setWorking] = useState<PaymentType | null>(null)
  const [error, setError] = useState('')
  // Cupón: se consulta al servidor cuánto descuenta y se vuelve a validar al reservar.
  const [couponInput, setCouponInput] = useState('')
  const [coupon, setCoupon] = useState<CouponQuote | null>(null)
  const [couponError, setCouponError] = useState('')
  const [checkingCoupon, setCheckingCoupon] = useState(false)

  async function applyCoupon() {
    if (!couponInput.trim() || checkingCoupon) return
    setCheckingCoupon(true)
    setCouponError('')
    try {
      const res = await fetch('/api/cuenta/cupones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quoteId: quote.id, code: couponInput }),
      })
      const body = await res.json().catch(() => ({}))
      if (res.ok && body?.coupon) setCoupon(body.coupon)
      else {
        setCoupon(null)
        setCouponError(res.status === 429 ? 'Demasiados intentos. Espera unos minutos.' : body?.error || 'No pudimos revisar el cupón.')
      }
    } catch {
      setCouponError('No pudimos conectarnos. Intenta de nuevo.')
    }
    setCheckingCoupon(false)
  }

  const [resuming, setResuming] = useState(false)
  const [resumeError, setResumeError] = useState('')

  async function resume() {
    if (resuming) return
    setResuming(true)
    setResumeError('')
    try {
      const res = await fetch(`/api/cuenta/cotizaciones/${quote.id}/retomar`)
      const body = await res.json().catch(() => ({}))
      if (res.ok && body?.state) {
        const { state, personalInfo } = body
        useQuoteStore.getState().resetQuote()
        useQuoteStore.setState({
          personalInfo,
          dateTime: state.dateTime ? new Date(state.dateTime) : null,
          isFlexible: state.isFlexible,
          origin: state.origin,
          destination: state.destination,
          stops: state.stops,
          items: state.items,
          additionalServices: state.additionalServices,
        })
        // Es una cotización nueva: no debe engancharse a un pago empezado antes en esta pestaña.
        try {
          sessionStorage.removeItem('yme_quote_id')
        } catch {}
        window.location.href = '/cotizador?start=online'
        return
      }
      setResumeError(body?.error || 'No pudimos abrir la cotización. Intenta de nuevo.')
    } catch {
      setResumeError('No pudimos conectarnos. Revisa tu conexión e intenta de nuevo.')
    }
    setResuming(false)
  }

  const abono50 = coupon ? coupon.abono50 : quote.amounts.abono50
  const full95 = coupon ? coupon.full95 : quote.amounts.full95

  async function reserve(paymentType: PaymentType) {
    if (!accepted) {
      setError('Para reservar debes aceptar nuestras Políticas de Garantía.')
      return
    }
    setWorking(paymentType)
    setError('')
    try {
      const res = await fetch(`/api/cuenta/cotizaciones/${quote.id}/reservar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentType, policiesAccepted: accepted, couponCode: coupon?.code || '' }),
      })
      const body = await res.json().catch(() => ({}))
      if (res.ok && body?.paymentUrl) {
        window.location.href = body.paymentUrl
        return
      }
      setError(body?.error || 'No pudimos crear el pago. Intenta de nuevo.')
    } catch {
      setError('No pudimos conectarnos. Revisa tu conexión e intenta de nuevo.')
    }
    setWorking(null)
  }

  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-bold text-brand-blue-dark">{quote.code || 'Cotización'}</span>
        <span
          className={`rounded-full px-3 py-1 text-xs font-bold ${
            quote.isOutstanding ? 'bg-lime-50 text-lime-700' : 'bg-slate-100 text-slate-500'
          }`}
        >
          {quote.isOutstanding ? 'Vigente' : 'Vencida'}
        </span>
      </div>
      <p className="mt-2 font-semibold text-slate-900">{route(quote.origin, quote.destination)}</p>
      <p className="mt-1 text-sm text-slate-500">
        {formatDate(quote.scheduledDate)}
        {formatTime(quote.scheduledTime)}
      </p>
      {quote.value > 0 && <p className="mt-3 text-xl font-bold text-slate-900">{clp(quote.value)}</p>}

      <div className="mt-4 flex flex-wrap gap-2">
        {quote.hasPdf && (
          <a
            href={`/api/cuenta/cotizaciones/${quote.id}/pdf`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border-2 border-slate-200 px-4 py-2 text-sm font-bold text-brand-blue-dark hover:border-brand-blue"
          >
            Descargar PDF
          </a>
        )}
        {quote.canReserve && !open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-lg bg-brand-green px-4 py-2 text-sm font-bold text-slate-900 hover:bg-brand-green-hover"
          >
            Reservar
          </button>
        )}
        {quote.canResume && (
          <button
            type="button"
            onClick={resume}
            disabled={resuming}
            className="rounded-lg border-2 border-slate-200 px-4 py-2 text-sm font-bold text-brand-blue-dark hover:border-brand-blue disabled:opacity-60"
          >
            {resuming ? 'Abriendo…' : 'Retomar cotización'}
          </button>
        )}
        {!quote.isOutstanding && !quote.canResume && (
          <a
            href="/cotizador?start=online"
            className="rounded-lg border-2 border-slate-200 px-4 py-2 text-sm font-bold text-brand-blue-dark hover:border-brand-blue"
          >
            Cotizar de nuevo
          </a>
        )}
      </div>

      {resumeError && <p className="mt-3 text-sm font-medium text-red-600">{resumeError}</p>}

      {quote.canReserve && open && (
        <div className="mt-4 space-y-3 rounded-xl bg-slate-50 p-4">
          <label className="flex cursor-pointer items-start gap-2.5 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={accepted}
              onChange={(e) => {
                setAccepted(e.target.checked)
                if (e.target.checked) setError('')
              }}
              className="mt-0.5 h-4 w-4 flex-shrink-0 rounded border-slate-300"
            />
            <span>
              Estoy de acuerdo con las{' '}
              <a
                href="/politicas-de-garantia"
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-brand-blue-dark underline"
              >
                Políticas de Garantía
              </a>{' '}
              de Yo me Encargo.
            </span>
          </label>

          <div>
            {coupon ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-lime-50 px-3 py-2 text-sm text-lime-800">
                <span>
                  <strong>{coupon.code}</strong> · {coupon.label}: −{clp(coupon.discount)}. Total {clp(coupon.finalPrice)}.
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setCoupon(null)
                    setCouponInput('')
                  }}
                  className="font-semibold underline"
                >
                  Quitar
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <input
                  value={couponInput}
                  onChange={(e) => {
                    setCouponInput(e.target.value.toUpperCase())
                    setCouponError('')
                  }}
                  maxLength={20}
                  placeholder="¿Tienes un cupón o código de referido?"
                  className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-brand-blue-dark focus:outline-none"
                />
                <button
                  type="button"
                  onClick={applyCoupon}
                  disabled={checkingCoupon || !couponInput.trim()}
                  className="rounded-lg border-2 border-slate-200 bg-white px-3 py-2 text-sm font-bold text-brand-blue-dark disabled:opacity-50"
                >
                  {checkingCoupon ? '…' : 'Aplicar'}
                </button>
              </div>
            )}
            {couponError && <p className="mt-1 text-sm font-medium text-red-600">{couponError}</p>}
          </div>

          <button
            type="button"
            disabled={working !== null}
            onClick={() => reserve('mitad')}
            className="w-full rounded-lg bg-brand-green px-4 py-3 text-left font-bold text-slate-900 hover:bg-brand-green-hover disabled:opacity-60"
          >
            <span className="block">{working === 'mitad' ? 'Creando el pago…' : 'Reservar con el 50%'}</span>
            <span className="block text-xl">{clp(abono50)}</span>
            <span className="block text-xs font-medium">El resto lo pagas al finalizar el traslado.</span>
          </button>
          <button
            type="button"
            disabled={working !== null}
            onClick={() => reserve('completo')}
            className="w-full rounded-lg border-2 border-slate-200 bg-white px-4 py-3 text-left font-bold text-slate-900 hover:border-brand-blue disabled:opacity-60"
          >
            <span className="block">{working === 'completo' ? 'Creando el pago…' : 'Pagar todo con 5% de descuento'}</span>
            <span className="block text-xl">{clp(full95)}</span>
          </button>

          {error && <p className="text-sm font-medium text-red-600">{error}</p>}
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              setError('')
            }}
            className="text-sm font-semibold text-slate-500 hover:text-slate-700"
          >
            Cancelar
          </button>
        </div>
      )}
    </div>
  )
}
