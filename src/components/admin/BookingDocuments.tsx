'use client'

import { useEffect, useState } from 'react'
import DocumentList, { type ListedDocument } from '@/components/documents/DocumentList'

/** Fotos y documentos que subieron el cliente o el equipo a una reserva (solo consulta). */
export default function BookingDocuments({ bookingId }: { bookingId: string }) {
  const [documents, setDocuments] = useState<ListedDocument[] | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    setDocuments(null)
    setError(false)
    fetch(`/api/admin/bookings/${bookingId}/documents`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data) => !cancelled && setDocuments(data.documents || []))
      .catch(() => !cancelled && setError(true))
    return () => {
      cancelled = true
    }
  }, [bookingId])

  return (
    <div className="rounded-lg border border-gray-200 p-4">
      <label className="mb-2 block text-sm font-medium text-gray-900">Fotos y documentos</label>
      {error ? (
        <p className="text-sm text-red-600">No se pudieron cargar los documentos.</p>
      ) : documents === null ? (
        <p className="text-sm text-gray-500">Cargando…</p>
      ) : (
        <DocumentList
          documents={documents}
          hrefFor={(doc, download) => `/api/admin/documents/${doc.id}${download ? '?descargar=1' : ''}`}
          empty="Nadie ha subido archivos a esta reserva."
        />
      )}
    </div>
  )
}
