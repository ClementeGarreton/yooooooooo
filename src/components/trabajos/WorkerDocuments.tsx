'use client'

import DocumentList, { type ListedDocument } from '@/components/documents/DocumentList'
import DocumentUploader from '@/components/documents/DocumentUploader'

/**
 * «Mis documentos» del trabajador: lo que subió a sus trabajos y sus documentos
 * personales (licencia, certificados), que no pertenecen a ningún servicio. Para dejar
 * algo en un trabajo, se sube desde la tarjeta de ese trabajo.
 */
export default function WorkerDocuments({ documents }: { documents: ListedDocument[] }) {
  return (
    <div className="mt-5 space-y-5">
      <DocumentUploader
        ticketsUrl="/api/trabajos/documentos/subir"
        confirmUrl="/api/trabajos/documentos/confirmar"
        title="Subir un documento personal"
        hint="Licencia, certificados u otro documento tuyo. Fotos o PDF, hasta 15 MB. Lo de un trabajo se sube desde ese trabajo."
        kinds={[{ value: 'documento', label: 'Documento' }]}
      />
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <DocumentList
          documents={documents}
          hrefFor={(doc, download) => `/api/trabajos/documentos/${doc.id}${download ? '?descargar=1' : ''}`}
          empty="Todavía no has subido nada."
        />
      </div>
    </div>
  )
}
