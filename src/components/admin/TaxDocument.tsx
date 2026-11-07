'use client'

import {
  IVA_RATE,
  TAX_DOCUMENT_OPTIONS,
  ivaBreakdown,
  normalizeTaxDocument,
  taxDocumentLabel,
} from '@/lib/taxDocument'

const clp = (n: number) => `$${Math.round(n).toLocaleString('es-CL')}`

const BADGE_STYLES: Record<string, string> = {
  boleta: 'border-sky-200 bg-sky-50 text-sky-800',
  factura: 'border-indigo-200 bg-indigo-50 text-indigo-800',
  sin_documento: 'border-gray-300 bg-gray-100 text-gray-700',
  sin_definir: 'border-dashed border-gray-300 bg-white text-gray-500',
}

/** Etiqueta compacta para la tabla de Reservas: documento y, si corresponde, el IVA. */
export function TaxDocumentBadge({ document, total }: { document?: string | null; total: number }) {
  const doc = normalizeTaxDocument(document)
  const desglose = ivaBreakdown(total, doc)
  return (
    <div
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${
        BADGE_STYLES[doc || 'sin_definir']
      }`}
      title={
        desglose
          ? `Neto ${clp(desglose.neto)} + IVA ${clp(desglose.iva)}`
          : doc
            ? 'Sin documento: no se desglosa IVA'
            : 'Documento sin definir: márcalo en «Editar»'
      }
    >
      {doc ? taxDocumentLabel(doc) : 'Documento sin definir'}
      {desglose && <span className="font-normal opacity-80">· IVA {clp(desglose.iva)}</span>}
    </div>
  )
}

/** Bloque del detalle de una reserva: documento, desglose del precio y de lo pagado. */
export function TaxDocumentDetail({
  document,
  total,
  paid,
}: {
  document?: string | null
  total: number
  paid: number
}) {
  const doc = normalizeTaxDocument(document)
  const precio = ivaBreakdown(total, doc)
  const pagado = ivaBreakdown(paid, doc)
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="block text-xs font-medium uppercase tracking-wide text-gray-500">
          Documento tributario
        </label>
        <TaxDocumentBadge document={doc} total={total} />
      </div>
      {precio ? (
        <div className="grid grid-cols-3 gap-2 rounded-lg bg-gray-50 p-3 text-sm">
          <div />
          <div className="text-xs font-medium text-gray-500">Neto</div>
          <div className="text-xs font-medium text-gray-500">IVA {Math.round(IVA_RATE * 100)}%</div>
          <div className="text-gray-700">Precio {clp(total)}</div>
          <div className="font-semibold text-gray-900">{clp(precio.neto)}</div>
          <div className="font-semibold text-gray-900">{clp(precio.iva)}</div>
          {pagado && (
            <>
              <div className="text-gray-700">Pagado {clp(paid)}</div>
              <div className="font-semibold text-green-700">{clp(pagado.neto)}</div>
              <div className="font-semibold text-green-700">{clp(pagado.iva)}</div>
            </>
          )}
        </div>
      ) : (
        <p className="text-xs text-gray-500">
          {doc === 'sin_documento'
            ? 'Va sin documento: no se desglosa IVA.'
            : doc
              ? 'Sin monto cargado para desglosar.'
              : 'Márcalo en «Editar» para ver el desglose del IVA.'}
        </p>
      )}
    </div>
  )
}

/** Selector de documento con el desglose en vivo del monto que se le pasa. */
export function TaxDocumentSelect({
  value,
  onChange,
  total,
}: {
  value?: string | null
  onChange: (value: string) => void
  total?: number
}) {
  const doc = normalizeTaxDocument(value)
  const desglose = total ? ivaBreakdown(total, doc) : null
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">Documento tributario</label>
      <select
        value={doc || ''}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
      >
        <option value="">Sin definir</option>
        {TAX_DOCUMENT_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <p className="mt-1 text-xs text-gray-500">
        {desglose
          ? `${clp(total || 0)} = neto ${clp(desglose.neto)} + IVA ${clp(desglose.iva)} (el precio ya incluye IVA).`
          : doc === 'sin_documento'
            ? 'Sin documento: no se desglosa IVA.'
            : 'El precio ya incluye IVA: con boleta o factura se muestra el neto y el IVA.'}
      </p>
    </div>
  )
}
