'use client'

import { useCallback, useEffect, useState } from 'react'
import Button from '@/components/ui/Button'
import toast from 'react-hot-toast'
import { INVOICE_STATUS_LABEL, type BillableBooking, type InvoiceView } from '@/lib/invoiceTypes'

/**
 * Facturación mensual de una empresa, en su ficha del admin. Quien factura revisa lo del
 * mes, elige las reservas, mira la VISTA PREVIA que calcula el SII y recién ahí emite.
 * Nada se emite solo, y no hay ambiente de prueba: emitir crea una factura real.
 */

const clp = (n: number | null) => `$${Math.round(n || 0).toLocaleString('es-CL')}`
const fmtDate = (d: string | null) => {
  if (!d) return '—'
  const [y, m, day] = d.slice(0, 10).split('-')
  return `${day}-${m}-${y}`
}

function currentPeriod(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date()).slice(0, 7)
}

const STATUS_CLASS: Record<InvoiceView['status'], string> = {
  previsualizada: 'bg-blue-50 text-blue-700',
  emitiendo: 'bg-amber-50 text-amber-700',
  emitida: 'bg-green-50 text-green-700',
  rechazada: 'bg-red-50 text-red-700',
  fallida: 'bg-gray-100 text-gray-600',
  desconocido: 'bg-amber-100 text-amber-800',
}

async function api(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.error || 'No se pudo completar la acción')
  return data
}

export default function CompanyBilling({
  companyId,
  companyName,
  initialPeriod,
  onChanged,
}: {
  companyId: string
  companyName: string
  /** Mes con el que abre ('YYYY-MM'). Sin esto, el mes en curso. */
  initialPeriod?: string
  /** Se llama cuando un intento de emisión terminó (para refrescar quien la contiene). */
  onChanged?: () => void
}) {
  const [period, setPeriod] = useState(initialPeriod || currentPeriod())
  const [bookings, setBookings] = useState<BillableBooking[]>([])
  const [invoices, setInvoices] = useState<InvoiceView[]>([])
  const [available, setAvailable] = useState(true)
  const [configured, setConfigured] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [preview, setPreview] = useState<InvoiceView | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  // La factura recién emitida: se ofrece su PDF arriba, sin tener que buscarla en la lista.
  const [justEmitted, setJustEmitted] = useState<{ id: string; folio: string | null } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api(`/api/admin/companies/${companyId}/billing?period=${period}`, 'GET')
      setBookings(data.bookings || [])
      setInvoices(data.invoices || [])
      setAvailable(data.available !== false)
      setConfigured(data.configured !== false)
      // Por defecto, lo que ya se hizo y todavía no se factura.
      setSelected(
        new Set(
          (data.bookings || [])
            .filter((b: BillableBooking) => !b.invoiced && b.status === 'completed' && b.total > 0)
            .map((b: BillableBooking) => b.id)
        )
      )
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo cargar la facturación')
    } finally {
      setLoading(false)
    }
  }, [companyId, period])

  useEffect(() => {
    setPreview(null)
    load()
  }, [load])

  const toggle = (id: string) => {
    setPreview(null) // la vista previa era de otra selección
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const chosen = bookings.filter((b) => selected.has(b.id) && !b.invoiced)
  const chosenTotal = chosen.reduce((sum, b) => sum + b.total, 0)

  const doPreview = async () => {
    if (busy || chosen.length === 0) return
    setBusy(true)
    try {
      const data = await api(`/api/admin/companies/${companyId}/billing`, 'POST', {
        period,
        bookingIds: chosen.map((b) => b.id),
      })
      setPreview(data.invoice)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo previsualizar')
    } finally {
      setBusy(false)
    }
  }

  const doEmit = async (invoice: InvoiceView, isRetry: boolean) => {
    if (busy) return
    if (
      !isRetry &&
      !window.confirm(
        `Vas a EMITIR ante el SII una factura a ${companyName} por ${clp(invoice.total)}.\n\nEs un documento tributario real: no hay ambiente de prueba y para deshacerlo hay que anularlo con nota de crédito.\n\n¿Emitir?`
      )
    ) {
      return
    }
    setBusy(true)
    try {
      const data = await api(`/api/admin/invoices/${invoice.id}/emit`, 'POST')
      const result: InvoiceView = data.invoice
      if (result.status === 'emitida') {
        toast.success(`Factura emitida: folio ${result.folio}`)
        setJustEmitted({ id: result.id, folio: result.folio })
      }
      else if (result.status === 'desconocido') toast.error('Resultado desconocido. NO previsualices de nuevo: usa «Consultar resultado».')
      else if (result.status === 'emitiendo') toast.error('Emisso está ocupado con otra operación. Espera unos segundos y consulta el resultado.')
      else toast.error(`No se emitió: ${result.errorMessage || result.errorCode || result.status}`)
      setPreview(null)
      await load()
      onChanged?.()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo emitir')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      {justEmitted && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-green-200 bg-green-50 px-4 py-3">
          <p className="text-sm font-semibold text-green-900">Factura emitida{justEmitted.folio ? `: folio ${justEmitted.folio}` : ''}.</p>
          <div className="flex flex-wrap gap-2">
            <a
              href={`/api/admin/invoices/${justEmitted.id}/pdf`}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md bg-green-700 px-3 py-1.5 text-sm font-bold text-white hover:bg-green-800"
            >
              Ver factura (PDF)
            </a>
            <a
              href={`/api/admin/invoices/${justEmitted.id}/pdf?descargar=1`}
              className="rounded-md border border-green-700 px-3 py-1.5 text-sm font-bold text-green-800 hover:bg-green-100"
            >
              Descargar
            </a>
          </div>
        </div>
      )}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-gray-500">
          Elige el mes, revisa las reservas y previsualiza. La factura sale a crédito, con una línea por servicio.
        </p>
        <input
          type="month"
          value={period}
          onChange={(e) => e.target.value && setPeriod(e.target.value)}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm"
        />
      </div>

      {!available && (
        <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Falta correr la migración <code>database/migrations/add_invoices.sql</code> para poder facturar.
        </p>
      )}
      {available && !configured && (
        <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Emisso no está configurado en el servidor (<code>EMISSO_CONNECT_API_KEY</code> y <code>EMISSO_CONNECTION_ID</code>):
          se puede revisar el mes, pero no previsualizar ni emitir.
        </p>
      )}

      {loading ? (
        <p className="text-sm text-gray-500">Cargando…</p>
      ) : bookings.length === 0 ? (
        <p className="text-sm text-gray-500">La empresa no tiene reservas con fecha en este mes.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="py-2 pr-2" />
                <th className="py-2 pr-3">Servicio</th>
                <th className="py-2 pr-3 text-right">Cotizado</th>
                <th className="py-2 pr-3 text-right">Ajustes</th>
                <th className="py-2 pr-3 text-right">Total</th>
                <th className="py-2 pr-3 text-right">Pagado</th>
                <th className="py-2">Factura</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {bookings.map((b) => (
                <tr key={b.id} className={b.invoiced ? 'text-gray-400' : ''}>
                  <td className="py-2 pr-2">
                    <input
                      type="checkbox"
                      disabled={!!b.invoiced || b.total <= 0 || busy}
                      checked={selected.has(b.id) && !b.invoiced}
                      onChange={() => toggle(b.id)}
                      aria-label={`Incluir ${b.code || 'reserva'}`}
                    />
                  </td>
                  <td className="py-2 pr-3">
                    <span className="font-medium text-gray-900">{b.code || 'Sin código'}</span>
                    <span className="block text-xs text-gray-500">
                      {fmtDate(b.scheduledDate)} · {b.clientName}
                      {b.status !== 'completed' ? ' · sin completar' : ''}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-right">{clp(b.quoted)}</td>
                  <td className={`py-2 pr-3 text-right ${b.adjustments > 0 ? 'text-amber-700' : b.adjustments < 0 ? 'text-blue-700' : ''}`}>
                    {b.adjustments === 0 ? '—' : `${b.adjustments > 0 ? '+' : '−'}${clp(Math.abs(b.adjustments))}`}
                  </td>
                  <td className="py-2 pr-3 text-right font-semibold">
                    {clp(b.total)}
                    {b.priceUf && !b.invoiced && (
                      <span className="block text-xs font-normal text-gray-500">
                        {b.priceUf.toLocaleString('es-CL')} UF + IVA{b.ufValue ? ` · UF de hoy ${clp(b.ufValue)}` : ' · sin UF de hoy'}
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-right">{clp(b.paid)}</td>
                  <td className="py-2 text-xs">
                    {b.invoiced
                      ? b.invoiced.folio
                        ? `Folio ${b.invoiced.folio}`
                        : INVOICE_STATUS_LABEL[b.invoiced.status]
                      : 'Sin facturar'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {available && bookings.length > 0 && !preview && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-gray-700">
            {chosen.length} reserva{chosen.length === 1 ? '' : 's'} elegida{chosen.length === 1 ? '' : 's'} ·{' '}
            <strong>{clp(chosenTotal)}</strong> con IVA
          </p>
          <Button size="sm" onClick={doPreview} disabled={busy || !configured || chosen.length === 0}>
            {busy ? 'Consultando al SII...' : 'Previsualizar factura'}
          </Button>
        </div>
      )}

      {preview && (
        <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-4">
          <p className="text-sm font-bold text-blue-900">Vista previa del SII — todavía no se emitió nada</p>
          <ul className="mt-2 space-y-0.5 text-sm text-blue-900">
            {preview.detalles.map((d, i) => (
              <li key={i} className="flex justify-between gap-3">
                <span>{d.nombre}</span>
                <span>{clp(d.precioUnitario)} neto</span>
              </li>
            ))}
          </ul>
          <dl className="mt-3 space-y-1 border-t border-blue-200 pt-2 text-sm text-blue-900">
            <div className="flex justify-between">
              <dt>Neto</dt>
              <dd>{clp(preview.neto)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>IVA</dt>
              <dd>{clp(preview.iva)}</dd>
            </div>
            <div className="flex justify-between font-bold">
              <dt>Total de la factura</dt>
              <dd>{clp(preview.total)}</dd>
            </div>
          </dl>
          {preview.total !== preview.panelTotal && (
            <p className="mt-2 text-xs text-blue-800">
              En el panel estas reservas suman {clp(preview.panelTotal)}: la diferencia de{' '}
              {clp(Math.abs((preview.total || 0) - preview.panelTotal))} es el redondeo del IVA que hace el SII.
            </p>
          )}
          <p className="mt-2 text-xs text-blue-800">
            Vence 15 minutos después de pedirla. Si cambias la selección hay que previsualizar de nuevo.
          </p>
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => setPreview(null)} disabled={busy}>
              Descartar
            </Button>
            <Button size="sm" onClick={() => doEmit(preview, false)} disabled={busy}>
              {busy ? 'Emitiendo...' : 'Emitir factura ante el SII'}
            </Button>
          </div>
        </div>
      )}

      {invoices.length > 0 && (
        <div className="mt-4">
          <p className="mb-1 text-xs font-bold uppercase tracking-wide text-gray-500">Facturas de este mes</p>
          <ul className="divide-y divide-gray-100">
            {invoices.map((inv) => (
              <li key={inv.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <div className="min-w-0">
                  <p className="font-medium text-gray-900">
                    {inv.folio ? `Folio ${inv.folio}` : 'Sin folio'} · {clp(inv.total)} · {inv.bookingCount} reserva
                    {inv.bookingCount === 1 ? '' : 's'}
                  </p>
                  <p className="text-xs text-gray-500">
                    {[inv.fechaEmision ? fmtDate(inv.fechaEmision) : null, inv.emittedBy, inv.operacionId].filter(Boolean).join(' · ')}
                  </p>
                  {inv.status !== 'emitida' && (inv.errorMessage || inv.errorCode) && (
                    <p className="text-xs text-gray-600">
                      {inv.errorMessage} {inv.errorCode ? `(${inv.errorCode})` : ''}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${STATUS_CLASS[inv.status]}`}>
                    {INVOICE_STATUS_LABEL[inv.status]}
                  </span>
                  {inv.status === 'emitida' && (
                    <a
                      href={`/api/admin/invoices/${inv.id}/pdf`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-md border border-gray-300 px-2 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                    >
                      PDF
                    </a>
                  )}
                  {inv.status === 'emitida' && (
                    <a
                      href={`/api/admin/invoices/${inv.id}/xml`}
                      className="rounded-md border border-gray-300 px-2 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                    >
                      XML
                    </a>
                  )}
                  {(inv.status === 'emitiendo' || inv.status === 'desconocido') && (
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => doEmit(inv, true)}>
                      Consultar resultado
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
