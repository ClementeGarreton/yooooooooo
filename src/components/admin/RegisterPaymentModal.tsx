'use client'

import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Banknote } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'

export interface PayableBooking {
  id: string
  client_name?: string | null
  quote_id?: string | null
}

interface RegisterPaymentModalProps {
  booking: PayableBooking | null
  /** Precio del servicio, lo pagado y el saldo, calculados por quien abre el pop-up. */
  total: number
  paid: number
  pending: number
  onClose: () => void
  onSaved: (bookingId: string, result: { amount_paid: number; pending: number }) => void
}

const clp = (n: number) => `$${Math.round(n).toLocaleString('es-CL')}`

/**
 * Anotar un pago recibido (transferencia o efectivo) sobre el saldo de una reserva.
 * Suma a lo ya pagado; no toca el precio. Lo pueden usar los dos perfiles.
 */
export default function RegisterPaymentModal({
  booking,
  total,
  paid,
  pending,
  onClose,
  onSaved,
}: RegisterPaymentModalProps) {
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<'transferencia' | 'efectivo' | 'otro'>('transferencia')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    // Por defecto, el saldo completo: es lo más común («ya pagó el resto»).
    setAmount(pending > 0 ? String(pending) : '')
    setMethod('transferencia')
    setNote('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booking?.id])

  const monto = Math.round(Number(amount) || 0)
  const quedara = Math.max(0, pending - monto)

  const save = async () => {
    if (!booking) return
    if (monto <= 0) {
      toast.error('Ingresa el monto que pagó el cliente')
      return
    }
    if (monto > pending) {
      toast.error(`No puede ser más que el saldo (${clp(pending)})`)
      return
    }
    setSaving(true)
    try {
      const res = await fetch(`/api/admin/bookings/${booking.id}/register-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: monto, method, note }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'No se pudo registrar el pago')
      toast.success(
        data.pending > 0
          ? `Pago registrado. Falta ${clp(data.pending)}`
          : 'Pago registrado. La reserva quedó pagada'
      )
      onSaved(booking.id, { amount_paid: data.amount_paid, pending: data.pending })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo registrar el pago')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal isOpen={Boolean(booking)} onClose={onClose} title="Registrar pago" size="sm">
      {booking && (
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            {booking.client_name || 'Reserva'}
            {booking.quote_id ? <span className="text-gray-400"> · {booking.quote_id}</span> : null}
          </p>

          <div className="grid grid-cols-3 gap-2 rounded-lg bg-gray-50 p-3 text-center text-sm">
            <div>
              <div className="text-xs text-gray-500">Total</div>
              <div className="font-semibold text-gray-900">{clp(total)}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500">Pagado</div>
              <div className="font-semibold text-green-700">{clp(paid)}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500">Falta</div>
              <div className="font-semibold text-orange-700">{clp(pending)}</div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Monto recibido</label>
              <Input
                type="number"
                min="1"
                step="1"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Medio</label>
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value as 'transferencia' | 'efectivo' | 'otro')}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                <option value="transferencia">Transferencia</option>
                <option value="efectivo">Efectivo</option>
                <option value="otro">Otro</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Nota <span className="font-normal text-gray-500">(opcional)</span>
            </label>
            <Input
              value={note}
              maxLength={300}
              placeholder="Ej: transferencia del 28-sep"
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          {monto > 0 && monto <= pending && (
            <p className="text-sm font-medium text-gray-700">
              {quedara > 0
                ? `Quedará pagado ${clp(paid + monto)} y faltarán ${clp(quedara)}.`
                : `Quedará pagada completa (${clp(paid + monto)}).`}
            </p>
          )}

          <div className="flex justify-end gap-2 border-t border-gray-100 pt-3">
            <Button onClick={onClose} variant="outline" size="sm">
              Cancelar
            </Button>
            <Button onClick={save} size="sm" isLoading={saving}>
              <Banknote className="mr-1.5 h-4 w-4" />
              Registrar pago
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
