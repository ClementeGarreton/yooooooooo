/**
 * Lista de documentos, común a los paneles. No firma nada: cada panel pasa `hrefFor`, que
 * apunta a SU ruta de apertura (la que valida quién mira antes de firmar la URL).
 */

export interface ListedDocument {
  id: string
  kind: 'foto' | 'documento' | 'gasto'
  file_name: string | null
  mime_type: string | null
  size_bytes: number | null
  note: string | null
  amount: number | null
  uploaded_by_type: 'cliente' | 'trabajador' | 'admin'
  uploaded_by_label: string | null
  created_at: string
  /** Rótulo opcional de contexto, p. ej. el código de la reserva. */
  context?: string | null
  /** Solo gastos de trabajadores (add_expense_review.sql). */
  expense_status?: 'pendiente' | 'aprobado' | 'rechazado' | null
  expense_reject_reason?: string | null
}

const KIND_LABEL = { foto: 'Foto', documento: 'Documento', gasto: 'Gasto' } as const
const UPLOADER_LABEL = { cliente: 'Cliente', trabajador: 'Equipo en terreno', admin: 'Yo me encargo' } as const

function formatSize(bytes: number | null): string {
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toLocaleString('es-CL', { maximumFractionDigits: 1 })} MB`
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString('es-CL', {
    timeZone: 'America/Santiago',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function DocumentList({
  documents,
  hrefFor,
  empty = 'Todavía no hay documentos.',
}: {
  documents: ListedDocument[]
  hrefFor: (doc: ListedDocument, download: boolean) => string
  empty?: string
}) {
  if (documents.length === 0) return <p className="text-sm text-slate-500">{empty}</p>

  return (
    <ul className="divide-y divide-slate-100">
      {documents.map((doc) => {
        const isPdf = doc.mime_type === 'application/pdf'
        return (
          <li key={doc.id} className="flex flex-wrap items-start gap-3 py-3">
            <span
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${
                isPdf ? 'bg-red-50 text-red-700' : 'bg-brand-blue-light text-brand-blue-dark'
              }`}
            >
              {isPdf ? 'PDF' : 'IMG'}
            </span>
            <div className="min-w-0 flex-1">
              <a
                href={hrefFor(doc, false)}
                target="_blank"
                rel="noopener noreferrer"
                className="block truncate font-semibold text-slate-900 hover:text-brand-blue-dark hover:underline"
              >
                {doc.file_name || KIND_LABEL[doc.kind]}
              </a>
              <p className="text-xs text-slate-500">
                {[
                  KIND_LABEL[doc.kind],
                  doc.context,
                  doc.uploaded_by_label || UPLOADER_LABEL[doc.uploaded_by_type],
                  formatWhen(doc.created_at),
                  formatSize(doc.size_bytes),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              {doc.amount !== null && (
                <p className="text-sm font-semibold text-slate-700">
                  ${Math.round(doc.amount).toLocaleString('es-CL')}
                  {doc.kind === 'gasto' && doc.uploaded_by_type === 'trabajador' && (
                    <span
                      className={`ml-2 rounded-full px-2 py-0.5 text-xs font-medium ${
                        doc.expense_status === 'aprobado'
                          ? 'bg-green-100 text-green-800'
                          : doc.expense_status === 'rechazado'
                            ? 'bg-red-100 text-red-700'
                            : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {doc.expense_status === 'aprobado' ? 'Aprobado' : doc.expense_status === 'rechazado' ? 'Rechazado' : 'Por aprobar'}
                    </span>
                  )}
                </p>
              )}
              {doc.note && <p className="mt-1 text-sm text-slate-600">{doc.note}</p>}
              {doc.expense_status === 'rechazado' && doc.expense_reject_reason && (
                <p className="mt-1 text-sm text-red-700">Motivo: {doc.expense_reject_reason}</p>
              )}
            </div>
            <a
              href={hrefFor(doc, true)}
              className="shrink-0 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-semibold text-brand-blue-dark hover:bg-slate-50"
            >
              Descargar
            </a>
          </li>
        )
      })}
    </ul>
  )
}
