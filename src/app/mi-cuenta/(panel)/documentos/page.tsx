import { bookingCodesFor, getDocumentScope, listCustomerDocuments } from '@/lib/customerDocuments'
import DocumentList from '@/components/documents/DocumentList'
import DocumentUploader from '@/components/documents/DocumentUploader'
import { requireCustomerId } from '../../session'
import PageTitle from '../../PageTitle'

export const dynamic = 'force-dynamic'

/**
 * Documentos (etapa 2): todo lo que la persona puede ver — lo que subió, lo de sus reservas
 * y, si es encargado de una empresa, lo de la empresa — más una subida suelta. Para dejar
 * algo asociado a un servicio, se sube desde el detalle de esa reserva.
 */
export default async function DocumentosPage() {
  const customerId = await requireCustomerId()
  const scope = await getDocumentScope(customerId)
  const documents = await listCustomerDocuments(scope)
  const codes = await bookingCodesFor(documents)

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 lg:px-10 lg:py-12">
      <PageTitle
        title="Documentos"
        subtitle={
          scope.company?.role === 'encargado'
            ? `Fotos y documentos tuyos y de ${scope.company.razon_social || 'tu empresa'}.`
            : 'Fotos y documentos de tus servicios.'
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm lg:col-span-2">
          <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500">
            {documents.length === 1 ? '1 archivo' : `${documents.length} archivos`}
          </h2>
          <div className="mt-2">
            <DocumentList
              documents={documents.map((d) => ({ ...d, context: d.booking_id ? codes.get(d.booking_id) : null }))}
              hrefFor={(doc, download) => `/api/cuenta/documentos/${doc.id}${download ? '?descargar=1' : ''}`}
              empty="Todavía no hay documentos. Puedes subir fotos o PDF acá o desde cada reserva."
            />
          </div>
        </section>

        <aside className="h-fit">
          <DocumentUploader
            ticketsUrl="/api/cuenta/documentos/subir"
            confirmUrl="/api/cuenta/documentos/confirmar"
            hint="Fotos (JPG, PNG, HEIC) o PDF, hasta 15 MB cada uno. Para asociarlos a un servicio, súbelos desde la reserva."
          />
        </aside>
      </div>
    </main>
  )
}
