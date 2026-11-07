'use client'

import { useCallback, useEffect, useState } from 'react'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Modal from '@/components/ui/Modal'
import toast from 'react-hot-toast'
import DocumentList from '@/components/documents/DocumentList'
import { formatRut, isValidRut } from '@/lib/rut'
import type { CustomerFicha as Ficha } from '@/lib/customerFichaTypes'
import { openPreview } from './openPreview'

/**
 * Ficha del cliente: todo lo de una persona en un solo lugar. Se abre desde la lista de
 * Clientes. Lo único que se edita acá es su ACCESO (RUT confirmado, clave, link al
 * correo); el resto son vistas de lo que ya existe, con salida a su lugar en el panel.
 */

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pendiente',
  confirmed: 'Confirmada',
  completed: 'Completada',
  cancelled: 'Cancelada',
  no_show: 'No atendida',
  pendiente: 'Esperando respuesta',
  aprobada: 'Aprobada',
  rechazada: 'Rechazada',
}

const clp = (n: number) => `$${Math.round(n).toLocaleString('es-CL')}`
const fmtDate = (d: string | null) => {
  if (!d) return 'Sin fecha'
  const [y, m, day] = d.slice(0, 10).split('-')
  return `${day}-${m}-${y}`
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-gray-200 pt-4">
      <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-gray-500">{title}</h3>
      {children}
    </section>
  )
}

export default function CustomerFicha({
  email,
  onClose,
  onOpenBooking,
}: {
  /** Correo del cliente a mostrar; null = cerrada. */
  email: string | null
  onClose: () => void
  /** Lleva a una reserva en la pestaña Reservas (por su quote_id). */
  onOpenBooking?: (quoteId: string) => void
}) {
  const [ficha, setFicha] = useState<Ficha | null>(null)
  const [missing, setMissing] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [rut, setRut] = useState('')
  /** Edición de nombre y teléfono (null = cerrada). */
  const [editData, setEditData] = useState<{ name: string; phone: string; email: string } | null>(null)

  const load = useCallback(async () => {
    if (!email) return
    setFicha(null)
    setMissing(null)
    try {
      const res = await fetch(`/api/admin/customers/ficha?email=${encodeURIComponent(email)}`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) return setMissing(data?.error || 'No se pudo cargar la ficha')
      setFicha(data.ficha)
      setRut(data.ficha.customer.rut ? formatRut(data.ficha.customer.rut) : '')
    } catch {
      setMissing('No se pudo cargar la ficha')
    }
  }, [email])

  useEffect(() => {
    load()
  }, [load])

  const act = async (method: 'PATCH' | 'POST', body: Record<string, unknown>, ok: string | ((data: any) => string)) => {
    if (!ficha || busy) return
    setBusy(true)
    try {
      const res = await fetch('/api/admin/customers/ficha', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId: ficha.customer.id, ...body }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'No se pudo completar la acción')
      toast.success(typeof ok === 'string' ? ok : ok(data))
      if (method === 'PATCH') await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo completar la acción')
    } finally {
      setBusy(false)
    }
  }

  const c = ficha?.customer

  return (
    <Modal isOpen={email !== null} onClose={onClose} title={c ? `${c.name || c.email} · ${c.code}` : 'Ficha del cliente'} size="xl">
      {missing ? (
        <p className="text-sm text-gray-600">{missing}</p>
      ) : !ficha || !c ? (
        <p className="text-sm text-gray-500">Cargando…</p>
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="text-sm text-gray-700">
              {editData ? (
                <div className="mb-2 flex flex-wrap items-end gap-2">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-600">Nombre</label>
                    <Input value={editData.name} onChange={(e) => setEditData({ ...editData, name: e.target.value })} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-600">Teléfono</label>
                    <Input type="tel" value={editData.phone} onChange={(e) => setEditData({ ...editData, phone: e.target.value })} />
                  </div>
                  <Button
                    size="sm"
                    disabled={busy || !editData.name.trim()}
                    onClick={async () => {
                      const emailChanged = editData.email.trim().toLowerCase() !== String(c.email || '').toLowerCase()
                      const dataChanged = editData.name.trim() !== (c.name || '') || editData.phone.trim() !== (c.phone || '')
                      if (dataChanged) await act('PATCH', { action: 'set_data', name: editData.name, phone: editData.phone }, 'Datos guardados')
                      if (emailChanged) {
                        const ok = window.confirm(
                          `¿Cambiar el correo a ${editData.email.trim()}? Con ese correo va a entrar a su cuenta, y se cambia también en sus reservas y cotizaciones.`
                        )
                        if (ok) {
                          await act('PATCH', { action: 'set_email', email: editData.email }, 'Correo cambiado')
                          // La ficha se abre por correo: con el nuevo ya no calza la que está abierta.
                          onClose()
                        }
                      }
                      setEditData(null)
                    }}
                  >
                    Guardar
                  </Button>
                  <button type="button" onClick={() => setEditData(null)} className="pb-2 text-sm text-gray-500">
                    Cancelar
                  </button>
                  <div className="basis-full">
                    <label className="mb-1 block text-xs font-medium text-gray-600">Correo (con él entra a su cuenta)</label>
                    <Input type="email" value={editData.email} onChange={(e) => setEditData({ ...editData, email: e.target.value })} />
                    <p className="mt-1 text-xs text-gray-500">
                      Cambiarlo lo cambia también en sus reservas y cotizaciones. No puede ser el correo de otra ficha.
                    </p>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setEditData({ name: c.name || '', phone: c.phone || '', email: c.email || '' })}
                  className="mb-1 text-xs font-semibold text-primary-600 hover:underline"
                >
                  Editar datos
                </button>
              )}
              <p>{[c.email, c.phone].filter(Boolean).join(' · ')}</p>
              {!String(c.email || '').includes('@') && (
                <p className="mt-1 rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                  Esta ficha no tiene un correo válido: la persona no puede entrar a su cuenta hasta que se lo corrijas en «Editar datos».
                </p>
              )}
              <p className="text-xs text-gray-500">Cliente desde el {fmtDate(c.createdAt)}</p>
              {ficha.company && (
                <p className="mt-1 text-sm font-medium text-gray-900">
                  {ficha.company.razon_social} · {ficha.company.code} ·{' '}
                  {ficha.company.role === 'encargado' ? 'Encargado' : 'Miembro'}
                </p>
              )}
            </div>
            <Button size="sm" variant="outline" onClick={() => openPreview({ kind: 'customer', id: c.id })}>
              Ver su panel
            </Button>
          </div>

          <Section title="Acceso a su cuenta">
            {!c.accountsAvailable ? (
              <p className="text-sm text-amber-800">
                Falta correr la migración <code>database/migrations/add_customer_accounts.sql</code>. Hoy esta persona
                entra solo con el link a su correo.
              </p>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-gray-700">
                  {c.hasPassword
                    ? `Tiene clave propia${c.passwordSetAt ? ` desde el ${fmtDate(c.passwordSetAt)}` : ''}. Entra con su correo y su clave.`
                    : c.rut
                      ? 'Todavía no crea su clave. Puede entrar por «Primera vez» con su correo y este RUT.'
                      : 'Sin RUT confirmado y sin clave: solo puede entrar con el link a su correo.'}
                </p>
                <div className="flex flex-wrap items-end gap-2">
                  <div className="w-52">
                    <label className="mb-1 block text-xs font-medium text-gray-600">RUT confirmado</label>
                    <Input value={rut} onChange={(e) => setRut(e.target.value)} placeholder="12.345.678-9" />
                  </div>
                  <Button
                    size="sm"
                    disabled={busy || (rut.trim() !== '' && !isValidRut(rut))}
                    onClick={() => act('PATCH', { action: 'set_rut', rut }, rut.trim() ? 'RUT guardado' : 'RUT quitado')}
                  >
                    Guardar RUT
                  </Button>
                  {rut.trim() !== '' && !isValidRut(rut) && <span className="text-xs text-red-600">El dígito verificador no calza.</span>}
                </div>
                {c.rutDeclared && c.rutDeclared !== c.rut && (
                  <div className="flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    <span>
                      En el cotizador escribió <strong>{formatRut(c.rutDeclared)}</strong>. No sirve para entrar hasta que
                      lo confirmes: verifica que sea de esta persona.
                    </span>
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => act('PATCH', { action: 'confirm_declared' }, 'RUT confirmado')}>
                      Confirmar este RUT
                    </Button>
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      act('POST', {}, (data) =>
                        data.detail === 'sent'
                          ? `Link enviado a ${c.email}`
                          : data.detail === 'throttled'
                            ? 'Ya se le enviaron varios links hace poco. Espera unos minutos.'
                            : 'No se pudo enviar el correo. Revisa el registro de correos.'
                      )
                    }
                  >
                    Enviarle el link de acceso
                  </Button>
                  {c.hasPassword && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => {
                        if (!window.confirm(`¿Borrar la clave de ${c.name || c.email}? Va a tener que crear una nueva.`)) return
                        act('PATCH', { action: 'reset_password' }, 'Clave borrada')
                      }}
                    >
                      Borrar su clave
                    </Button>
                  )}
                </div>
              </div>
            )}
          </Section>

          <Section title={`Reservas (${ficha.bookings.length})`}>
            {ficha.bookings.length === 0 ? (
              <p className="text-sm text-gray-500">Sin reservas.</p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {ficha.bookings.map((b) => (
                  <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                    <div>
                      <p className="font-medium text-gray-900">
                        {b.code || 'Sin código'} · {fmtDate(b.scheduledDate)} · {STATUS_LABEL[b.status || ''] || b.status}
                      </p>
                      <p className="text-xs text-gray-500">
                        {clp(b.price)} · pagado {clp(b.paid)}
                        {b.pending > 0 ? ` · saldo ${clp(b.pending)}` : ''}
                      </p>
                    </div>
                    {onOpenBooking && b.quoteId && (
                      <Button size="sm" variant="outline" onClick={() => onOpenBooking(b.quoteId!)}>
                        Abrir
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title={`Cotizaciones sin reserva (${ficha.quotes.length})`}>
            {ficha.quotes.length === 0 ? (
              <p className="text-sm text-gray-500">Ninguna.</p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {ficha.quotes.map((q) => (
                  <li key={q.id} className="py-2 text-sm text-gray-900">
                    {q.code || 'Cotización'} · {fmtDate(q.scheduledDate)} · {clp(q.value)} ·{' '}
                    <span className={q.isOutstanding ? 'text-green-700' : 'text-gray-500'}>{q.isOutstanding ? 'Vigente' : 'Vencida'}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {ficha.requests.length > 0 && (
            <Section title={`Solicitudes (${ficha.requests.length})`}>
              <ul className="divide-y divide-gray-100">
                {ficha.requests.map((r) => (
                  <li key={r.id} className="py-2 text-sm text-gray-900">
                    {r.code} · {r.label} · {STATUS_LABEL[r.status] || r.status}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section title={`Documentos (${ficha.documents.length})`}>
            <DocumentList
              documents={ficha.documents}
              hrefFor={(doc, download) => `/api/admin/documents/${doc.id}${download ? '?descargar=1' : ''}`}
              empty="Sin documentos."
            />
          </Section>

          {(ficha.benefits.referralCode || ficha.benefits.prizes.length > 0) && (
            <Section title="Beneficios">
              {ficha.benefits.referralCode && (
                <p className="text-sm text-gray-900">
                  Código de referido <span className="font-mono font-bold">{ficha.benefits.referralCode}</span> ·{' '}
                  {ficha.benefits.referredCount} reservaron con él · {ficha.benefits.completedCount} servicios realizados
                </p>
              )}
              {ficha.benefits.prizes.map((p) => (
                <p key={p.code} className="text-sm text-gray-700">
                  Cupón <span className="font-mono font-bold">{p.code}</span> · {p.label} · {p.state}
                </p>
              ))}
            </Section>
          )}

          <div className="flex justify-end pt-2">
            <Button variant="outline" onClick={onClose}>
              Cerrar
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
