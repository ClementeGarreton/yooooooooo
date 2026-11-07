import { NextRequest, NextResponse } from 'next/server'
import { resolveWorkerUploadTarget } from '@/lib/workerUploadTarget'
import {
  confirmUploads,
  DocumentUploadError,
  findExpensesByDocNumber,
  normalizeDocNumber,
  type DocumentKind,
} from '@/lib/documents'
import { RECEPTION_NOTE } from '@/lib/companyClosingTypes'

export const dynamic = 'force-dynamic'

const KINDS: DocumentKind[] = ['foto', 'gasto', 'documento']
/** Tope de un gasto rendido desde terreno: evita un cero de más al teclear. */
const MAX_AMOUNT = 5_000_000

/**
 * Paso 3 de la subida del trabajador: revisa los archivos y los registra en la reserva.
 * Body: `{ bookingId, items: [{ path, fileName }], kind, note?, amount?, docNumber? }`.
 * Un gasto lleva nombre (en `note`), monto y N° de boleta o factura, un comprobante por gasto.
 * El mismo N° con el mismo monto es un gasto ya rendido y se rechaza; el mismo N° con otro
 * monto se acepta (dos comercios pueden repetir numeración) y el panel lo marca. El gasto queda «por aprobar»
 * en el panel (Por aprobar → Gastos de trabajadores).
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Solicitud inválida' }, { status: 400 })

  // Sin reserva = documento personal del trabajador.
  const target = await resolveWorkerUploadTarget(body.bookingId, { allowPersonal: true })
  if (!target.ok) return NextResponse.json({ error: target.error }, { status: target.status })

  const kind: DocumentKind = KINDS.includes(body.kind) ? body.kind : 'foto'
  let amount: number | null = null
  let docNumber: string | null = null
  let expensePayment: 'contado' | 'credito' | null = null
  if (kind === 'gasto') {
    amount = Math.round(Number(body.amount))
    if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT) {
      return NextResponse.json({ error: 'Escribe el monto del gasto, en pesos.' }, { status: 400 })
    }
    if (typeof body.note !== 'string' || !body.note.trim()) {
      return NextResponse.json({ error: 'Escribe el nombre del gasto.' }, { status: 400 })
    }
    // Un gasto = un comprobante: el monto es de ese archivo, y se aprueba o rechaza entero.
    if (Array.isArray(body.items) && body.items.length > 1) {
      return NextResponse.json({ error: 'Sube un comprobante por gasto.' }, { status: 400 })
    }
    // Contado = lo pagó el trabajador y hay que devolvérselo; crédito = lo pagó la empresa.
    if (body.expensePayment !== 'contado' && body.expensePayment !== 'credito') {
      return NextResponse.json({ error: 'Indica cómo se pagó: contado o crédito.' }, { status: 400 })
    }
    expensePayment = body.expensePayment
    docNumber = normalizeDocNumber(body.docNumber)
    if (!docNumber) {
      return NextResponse.json({ error: 'Escribe el N° de la boleta o factura.' }, { status: 400 })
    }
    const repeated = (await findExpensesByDocNumber(docNumber)).find((e) => e.amount === amount)
    if (repeated) {
      const date = new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', day: '2-digit', month: '2-digit' }).format(
        new Date(repeated.createdAt)
      )
      return NextResponse.json(
        { error: `Ese comprobante ya está rendido: N° ${docNumber} por el mismo monto (${repeated.label}, ${date}).` },
        { status: 409 }
      )
    }
  }

  const items = Array.isArray(body.items)
    ? body.items.map((i: any) => ({ path: String(i?.path || ''), fileName: String(i?.fileName || '') }))
    : []

  try {
    const saved = await confirmUploads({
      folder: target.folder,
      items,
      uploader: { type: 'trabajador', id: target.worker.id, label: target.label },
      bookingId: target.bookingId,
      kind,
      // La foto de la recepción de una entrega de empresa queda marcada con su nota fija.
      note: body.purpose === 'recepcion' && kind === 'foto' ? RECEPTION_NOTE : typeof body.note === 'string' ? body.note : null,
      amount,
      docNumber,
      expensePayment,
    })
    return NextResponse.json({ ok: true, count: saved.length })
  } catch (error) {
    if (error instanceof DocumentUploadError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('[trabajos/documentos/confirmar] Error:', error)
    return NextResponse.json({ error: 'No pudimos registrar los archivos. Intenta de nuevo.' }, { status: 500 })
  }
}
