import { NextRequest, NextResponse } from 'next/server'
import { pickAttribution, pickVisitorId, backfillAttribution, saveProspectVisitorId } from '@/lib/attributionServer'
import { QuoteProspectInputError, upsertQuoteProspect } from '@/lib/server/quoteProspects'
import { saveDeclaredRut } from '@/lib/customerPassword'

// El guardado vive en `upsertQuoteProspect`, compartido con el cotizador interno del
// panel. Esta ruta es la de la web: agrega la atribución de Google Ads y nada más.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    const { prospect } = await upsertQuoteProspect(body)

    // Atribucion de Google Ads: se guarda aparte del upsert para NO sobrescribir un
    // gclid ya guardado en re-guardados del mismo prospecto (first-touch por fila).
    await backfillAttribution('quote_prospects', prospect.id, pickAttribution(body), prospect)
    await saveProspectVisitorId(prospect.id, pickVisitorId(body))

    // RUT de la persona (opcional en el cotizador): queda como «declarado» en su ficha de
    // cliente. No sirve para entrar a la cuenta hasta que el equipo lo confirma, y no
    // frena la cotización si falla (ver customerPassword.ts).
    if (body?.rut) await saveDeclaredRut(body.email, body.rut)

    return NextResponse.json(
      {
        success: true,
        prospectId: prospect.id,
        message: 'Prospecto guardado exitosamente',
      },
      { status: 201 }
    )
  } catch (error) {
    if (error instanceof QuoteProspectInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    console.error('[Prospects] Error in /api/prospects/create:', error)
    return NextResponse.json({ error: 'Error al guardar el prospecto' }, { status: 500 })
  }
}
