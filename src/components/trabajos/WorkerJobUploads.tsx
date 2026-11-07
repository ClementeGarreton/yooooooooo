'use client'

import { useState } from 'react'
import DocumentList, { type ListedDocument } from '@/components/documents/DocumentList'
import DocumentUploader from '@/components/documents/DocumentUploader'

const KINDS = [
  { value: 'foto' as const, label: 'Foto del servicio' },
  { value: 'gasto' as const, label: 'Gasto' },
  { value: 'documento' as const, label: 'Documento' },
]

/**
 * Fotos, gastos y documentos que el trabajador sube a un trabajo de su agenda. Ve solo lo
 * que subió él. Va plegado: en una jornada hay varias tarjetas y el formulario abierto en
 * todas haría la lista interminable.
 */
export default function WorkerJobUploads({ bookingId, documents }: { bookingId: string; documents: ListedDocument[] }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="mt-3 border-t border-gray-100 pt-3">
      {documents.length > 0 && (
        <div className="mb-2">
          <DocumentList
            documents={documents}
            hrefFor={(doc, download) => `/api/trabajos/documentos/${doc.id}${download ? '?descargar=1' : ''}`}
          />
        </div>
      )}
      {open ? (
        <div>
          <DocumentUploader
            ticketsUrl="/api/trabajos/documentos/subir"
            confirmUrl="/api/trabajos/documentos/confirmar"
            extra={{ bookingId }}
            title="Subir a este trabajo"
            hint="Fotos o PDF, hasta 15 MB cada uno. Un gasto lleva nombre, monto y un comprobante."
            kinds={KINDS}
          />
          <button type="button" onClick={() => setOpen(false)} className="mt-2 text-xs font-medium text-gray-500">
            Cerrar
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-xs font-semibold text-blue-700 underline underline-offset-2"
        >
          + Subir foto, gasto o documento
        </button>
      )}
    </div>
  )
}
