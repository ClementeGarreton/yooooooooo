import { NextResponse } from 'next/server'
import { getSessionWorker } from '@/lib/workerSession'
import { getOwnPayClosing, WorkerPayError } from '@/lib/workerPay'

export const dynamic = 'force-dynamic'

/** Detalle de un cierre de pago del trabajador con sesión, para armar su PDF en el navegador. */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const worker = await getSessionWorker()
  if (!worker) return NextResponse.json({ error: 'Tu sesión venció. Vuelve a entrar.' }, { status: 401 })
  try {
    return NextResponse.json(await getOwnPayClosing(worker.id, params.id))
  } catch (error) {
    if (error instanceof WorkerPayError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('[trabajos/pagos] Error:', error)
    return NextResponse.json({ error: 'No pudimos armar el detalle. Intenta de nuevo.' }, { status: 500 })
  }
}
