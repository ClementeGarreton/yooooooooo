import { NextRequest, NextResponse } from 'next/server'
import { hasAdminAction } from '@/lib/adminPermissions'
import { getActorFromRequest, logAdminAction } from '@/lib/activityLog'
import { supabaseAdmin } from '@/lib/supabase'
import { readPricingConfig } from '@/lib/server/pricingConfigServer'
import { sanitizeQuoteState } from '@/lib/quoteState'
import { parseReviewRates, reviewPrice } from '@/lib/quotePriceReview'

export async function POST(request: NextRequest) {
  if (!(await hasAdminAction(request, 'pricing.edit'))) {
    return NextResponse.json({ error: 'No tienes permiso para ajustar precios' }, { status: 403 })
  }
  try {
    const { prospectId, overrides, comment } = await request.json()
    if (typeof prospectId !== 'string' || !/^[0-9a-f-]{36}$/i.test(prospectId)) {
      return NextResponse.json({ error: 'Prospecto inválido' }, { status: 400 })
    }
    const rates = parseReviewRates(overrides || {})
    const { data: prospect, error } = await supabaseAdmin.from('quote_prospects')
      .select('id,name,status,total_price,total_distance,quote_state,adjusted_price,price_review')
      .eq('id', prospectId).single()
    if (error || !prospect) return NextResponse.json({ error: 'Prospecto no encontrado' }, { status: 404 })
    if (prospect.status === 'converted') return NextResponse.json({ error: 'Esta cotización ya es una reserva: usa su flujo de edición' }, { status: 409 })
    const state = sanitizeQuoteState(prospect.quote_state)
    if (!state || !state.items.length) return NextResponse.json({ error: 'Esta cotización no conserva inventario detallado para recálculo. Puedes ajustar el precio total manualmente.' }, { status: 422 })
    const km = Number(prospect.total_distance)
    if (!Number.isFinite(km) || km < 0) return NextResponse.json({ error: 'Falta la distancia de la cotización' }, { status: 422 })
    const config = await readPricingConfig()
    const result = reviewPrice(state, km, config, rates)
    if (!Number.isFinite(result.reviewed) || result.reviewed <= 0) return NextResponse.json({ error: 'Precio resultante inválido' }, { status: 422 })
    const review = { overrides: rates, rates: {
      pricePerCubicMeter: config.pricePerCubicMeter,
      pricePerKilometer: config.pricePerKilometer,
      packing: config.additionalServices.packing,
      disassembly: config.additionalServices.disassembly,
      assembly: config.additionalServices.assembly,
    }, calculatedAt: new Date().toISOString(), original: result.original,
      reviewed: result.reviewed, components: result.components }
    const { data, error: saveError } = await supabaseAdmin.from('quote_prospects').update({
      adjusted_price: result.reviewed,
      adjustment_comment: String(comment || '').trim().slice(0, 1000) || null,
      price_review: review,
      price_reviewed_at: new Date().toISOString(),
      pdf_url: null, pdf_generated_at: null, // Un PDF con el precio viejo no es válido.
      updated_at: new Date().toISOString(),
    }).eq('id', prospectId).select('*').single()
    if (saveError) throw saveError
    await logAdminAction({ actor: getActorFromRequest(request), request,
      action: 'prospect.price_adjusted', entityType: 'prospect', entityId: prospectId,
      entityLabel: prospect.name, summary: `Revisó los componentes del precio; valor estimado $${result.reviewed}`,
      changes: { original: prospect.adjusted_price ?? prospect.total_price, review } })
    return NextResponse.json({ success: true, prospect: data, review })
  } catch (error) {
    if (error instanceof Error && /Tarifa|tarifas|válido|desconocida|inválidas/.test(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    console.error('[Admin price review]', error)
    return NextResponse.json({ error: 'No se pudo guardar la revisión' }, { status: 500 })
  }
}
