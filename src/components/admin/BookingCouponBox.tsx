'use client'

import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import Button from '@/components/ui/Button'

/**
 * Código de referido o cupón de una reserva, aplicado desde el panel. Es lo mismo que en
 * AppleFix, donde el código se canjea en la orden: quien reserva por WhatsApp o teléfono le
 * dicta su código a quien lo atiende. Aplicarlo rebaja el precio (queda como reajuste, con
 * su motivo) y registra el uso; quien refirió gana sus créditos cuando la reserva se paga.
 */

interface AppliedCoupon {
  code: string
  origin: 'manual' | 'referido' | 'premio'
  discount: number
  amountBefore: number
  amountAfter: number
}

const clp = (n: number) => `$${Math.round(n).toLocaleString('es-CL')}`

export default function BookingCouponBox({
  bookingId,
  onChanged,
}: {
  bookingId: string
  /** El precio de la reserva cambió: el que llama vuelve a leerla. */
  onChanged: () => void
}) {
  const [coupon, setCoupon] = useState<AppliedCoupon | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/bookings/${bookingId}/coupon`)
      const body = await res.json().catch(() => ({}))
      setCoupon(res.ok ? body.coupon || null : null)
    } catch {
      setCoupon(null)
    } finally {
      setLoaded(true)
    }
  }, [bookingId])

  useEffect(() => {
    setLoaded(false)
    setCode('')
    load()
  }, [load])

  const call = async (method: 'POST' | 'DELETE', ok: string) => {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/bookings/${bookingId}/coupon`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: method === 'POST' ? JSON.stringify({ code }) : undefined,
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || 'No se pudo completar')
      toast.success(ok)
      setCode('')
      await load()
      onChanged()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo completar')
    } finally {
      setBusy(false)
    }
  }

  if (!loaded) return null

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Código de referido o cupón</p>
      {coupon ? (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-gray-800">
            <span className="rounded-md bg-gray-900 px-2 py-0.5 font-mono text-sm font-semibold text-white">{coupon.code}</span>{' '}
            <span className="font-semibold">{coupon.origin === 'referido' ? 'Llegó referido' : 'Cupón'}</span> · descuento de{' '}
            {clp(coupon.discount)} ({clp(coupon.amountBefore)} → {clp(coupon.amountAfter)})
          </p>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => {
              if (window.confirm(`¿Quitar el código ${coupon.code}? La reserva vuelve a ${clp(coupon.amountBefore)}.`)) call('DELETE', 'Código quitado')
            }}
          >
            Quitar
          </Button>
        </div>
      ) : (
        <>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="Ej.: CAMILA7KQ2"
              maxLength={24}
              className="w-56 rounded-lg border border-gray-300 px-3 py-1.5 font-mono text-sm uppercase"
            />
            <Button size="sm" disabled={busy || code.trim().length < 4} onClick={() => call('POST', 'Código aplicado')}>
              Aplicar
            </Button>
          </div>
          <p className="mt-1 text-xs text-gray-500">
            Rebaja el precio de esta reserva y registra el uso. Si es un código de referido, quien lo recomendó gana sus
            créditos cuando la reserva se pague.
          </p>
        </>
      )}
    </div>
  )
}
