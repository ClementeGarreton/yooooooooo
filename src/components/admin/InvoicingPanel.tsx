'use client'

import { useCallback, useEffect, useState } from 'react'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import toast from 'react-hot-toast'
import { INVOICE_STATUS_LABEL } from '@/lib/invoiceTypes'
import type { FinanceCompany, FinanceData } from '@/lib/financeTypes'
import CompanyBilling from './CompanyBilling'
import CompanyDataEditor from './CompanyDataEditor'

/**
 * Emisión de facturas: panel propio, separado de Finanzas (que quedó solo para mirar la
 * plata del mes). Lista cada empresa con servicios del mes; el botón abre la misma
 * revisión → vista previa del SII → emisión con Emisso que tiene la ficha de la empresa.
 * Abajo, las facturas del mes con su estado y el XML. Lee los mismos datos que Finanzas
 * (`/api/admin/finance`).
 */

const clp = (n: number | null) => `$${Math.round(n || 0).toLocaleString('es-CL')}`
const fmtDate = (d: string | null) => {
  if (!d) return '—'
  const [y, m, day] = d.slice(0, 10).split('-')
  return `${day}-${m}-${y}`
}
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

export default function InvoicingPanel() {
  const [period, setPeriod] = useState('')
  const [data, setData] = useState<FinanceData | null>(null)
  const [billing, setBilling] = useState<FinanceCompany | null>(null)
  const [editing, setEditing] = useState<FinanceCompany | null>(null)

  const load = useCallback(async (mes: string) => {
    try {
      const res = await fetch(`/api/admin/finance${mes ? `?mes=${mes}` : ''}`)
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || 'No se pudo cargar la facturación')
      setData(body)
      setPeriod(body.period)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo cargar la facturación')
    }
  }, [])

  useEffect(() => {
    load('')
  }, [load])

  if (!data) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary-600" />
      </div>
    )
  }

  const [py, pm] = data.period.split('-').map(Number)
  const monthName = `${MONTHS[pm - 1]} de ${py}`
  const toBill = data.companies.filter((c) => c.unbilledCount > 0)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Emisión de facturas</h2>
          <p className="text-gray-600">Servicios de empresas de {monthName}, por fecha del servicio. Montos con IVA.</p>
        </div>
        <input
          type="month"
          value={period}
          onChange={(e) => {
            if (!e.target.value) return
            setPeriod(e.target.value)
            load(e.target.value)
          }}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
        />
      </div>

      <Card className="p-5">
        <h3 className="text-lg font-bold text-gray-900">Empresas con servicios en el mes</h3>
        <p className="text-sm text-gray-600">
          Factura 33 por los servicios del mes de cada empresa. Primero se ve la vista previa del SII; nada se emite solo.
        </p>
        {!data.invoicesAvailable ? (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Falta correr la migración <code>database/migrations/add_invoices.sql</code>.
          </p>
        ) : (
          !data.emissoConfigured && (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Emisso no está configurado en el servidor (<code>EMISSO_CONNECT_API_KEY</code> y <code>EMISSO_CONNECTION_ID</code>):
              se puede revisar cada empresa, pero no previsualizar ni emitir.
            </p>
          )
        )}
        {data.companies.length === 0 ? (
          <p className="mt-3 text-sm text-gray-500">
            Ninguna reserva de este mes está asignada a una empresa. Se asignan desde la ficha de la empresa.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-gray-100">
            {data.companies.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-900">
                    {c.razon_social} <span className="font-normal text-gray-500">· {c.code}</span>
                  </p>
                  <p className="text-xs text-gray-500">
                    {c.unbilledCount > 0
                      ? `${c.unbilledCount} sin facturar (${c.completedUnbilledCount} completada${c.completedUnbilledCount === 1 ? '' : 's'}) · ${clp(c.unbilledTotal)}`
                      : 'Todo facturado'}
                    {c.invoicedTotal > 0 ? ` · ya facturado ${clp(c.invoicedTotal)}` : ''}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => setEditing(c)}>
                    Editar empresa
                  </Button>
                  <Button size="sm" variant={c.unbilledCount > 0 ? 'primary' : 'outline'} onClick={() => setBilling(c)}>
                    {c.unbilledCount > 0 ? 'Revisar y facturar' : 'Ver facturas'}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {toBill.length > 0 && (
          <p className="mt-2 text-xs text-gray-500">
            Por facturar en el mes: {clp(toBill.reduce((sum, c) => sum + c.unbilledTotal, 0))} en {toBill.length} empresa
            {toBill.length === 1 ? '' : 's'}.
          </p>
        )}

        {data.invoices.length > 0 && (
          <div className="mt-5 border-t border-gray-100 pt-4">
            <p className="mb-1 text-xs font-bold uppercase tracking-wide text-gray-500">Facturas del mes</p>
            <ul className="divide-y divide-gray-100">
              {data.invoices.map((inv) => (
                <li key={inv.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span className="text-gray-900">
                    {inv.folio ? `Folio ${inv.folio}` : 'Sin folio'} · {inv.company} · {clp(inv.total)}
                    <span className="text-xs text-gray-500">
                      {' '}
                      {[inv.fechaEmision ? fmtDate(inv.fechaEmision) : null, inv.emittedBy].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
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
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>


      <Modal isOpen={billing !== null} onClose={() => setBilling(null)} title={billing ? `Facturar a ${billing.razon_social}` : ''} size="xl">
        {billing && (
          <CompanyBilling companyId={billing.id} companyName={billing.razon_social} initialPeriod={data.period} onChanged={() => load(data.period)} />
        )}
      </Modal>

      <Modal isOpen={editing !== null} onClose={() => setEditing(null)} title={editing ? `Datos de ${editing.razon_social}` : ''} size="lg">
        {editing && (
          <CompanyDataEditor
            companyId={editing.id}
            onSaved={() => {
              setEditing(null)
              load(data.period)
            }}
          />
        )}
      </Modal>
    </div>
  )
}
