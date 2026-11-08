import { NextRequest, NextResponse } from 'next/server'
import { hasAdminAction } from '@/lib/adminPermissions'
import { supabaseAdmin } from '@/lib/supabase'
import { getActorFromRequest, logAdminAction } from '@/lib/activityLog'

/** Sólo expedientes de los seis grupos de Tommy. No modifica tarifas globales. */
const components = ['distance', 'volume', 'packing', 'stairs', 'other'] as const
type Component = typeof components[number]

export async function POST(request: NextRequest) {
  if (!(await hasAdminAction(request, 'pricing.edit'))) {
    return NextResponse.json({ error: 'No tienes permiso para revisar cotizaciones' }, { status: 403 })
  }
  try {
    const body = await request.json()
    if (typeof body.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.id)) {
      return NextResponse.json({ error: 'Expediente inválido' }, { status: 400 })
    }
    const { data, error } = await supabaseAdmin.from('handoff_requests')
      .select('id,quote_snapshot,status,reason,phone')
      .eq('id', body.id).single()
    if (error || !data) return NextResponse.json({ error: 'Expediente no encontrado' }, { status: 404 })
    if (data.status !== 'ready' || data.reason !== 'Cotización pendiente de revisión humana') {
      return NextResponse.json({ error: 'El expediente no admite revisión de precios' }, { status: 409 })
    }
    const snapshot = data.quote_snapshot && typeof data.quote_snapshot === 'object' ? data.quote_snapshot : {}
    const base = snapshot.priceEstimateForReview === null || snapshot.priceEstimateForReview === undefined
      ? null : Number(snapshot.priceEstimateForReview)
    if (base !== null && (!Number.isFinite(base) || base <= 0)) {
      return NextResponse.json({ error: 'Precio preliminar inválido' }, { status: 422 })
    }
    if (!body.adjustments || typeof body.adjustments !== 'object') {
      return NextResponse.json({ error: 'Indica los ajustes por concepto' }, { status: 400 })
    }
    if (Object.keys(body.adjustments).some(key => !components.includes(key as Component))) {
      return NextResponse.json({ error: 'Hay un concepto desconocido' }, { status: 400 })
    }
    const adjustments = {} as Record<Component, number>
    for (const key of components) {
      const raw = body.adjustments[key] ?? 0
      const n = Number(raw)
      if (typeof raw === 'boolean' || !Number.isFinite(n) || !Number.isSafeInteger(n) || Math.abs(n) > 30_000_000) {
        return NextResponse.json({ error: `Ajuste inválido: ${key}` }, { status: 400 })
      }
      adjustments[key] = n
    }
    const override = body.overrideTotal === '' || body.overrideTotal === null || body.overrideTotal === undefined
      ? null : Number(body.overrideTotal)
    if (override !== null && (!Number.isFinite(override) || !Number.isSafeInteger(override) || override < 1 || override > 500_000_000)) {
      return NextResponse.json({ error: 'Precio final inválido' }, { status: 400 })
    }
    if (base === null && override === null) {
      return NextResponse.json({ error: 'Sin cálculo preliminar: debes ingresar el precio manualmente' }, { status: 422 })
    }
    const price = override ?? (base! + components.reduce((sum, key) => sum + adjustments[key], 0))
    if (!Number.isSafeInteger(price) || price < 1 || price > 500_000_000) {
      return NextResponse.json({ error: 'Precio revisado inválido' }, { status: 422 })
    }
    const previous = snapshot.tommyPriceReview || null
    const review = {
      originalPrice: base, adjustments, overrideTotal: override,
      reviewedPrice: price, note: String(body.note || '').slice(0, 1000),
      reviewedAt: new Date().toISOString(),
    }
    const history = Array.isArray(snapshot.tommyReviewHistory) ? snapshot.tommyReviewHistory.slice(-19) : []
    const { data: updated, error: updateError } = await supabaseAdmin.from('handoff_requests')
      .update({ quote_snapshot: { ...snapshot, tommyPriceReview: review,
        tommyReviewHistory: [...history, review] }, updated_at: new Date().toISOString() })
      .eq('id', body.id).eq('status', 'ready').select('id').maybeSingle()
    if (updateError) throw updateError
    if (!updated) return NextResponse.json({ error: 'El expediente cambió de estado' }, { status: 409 })
    await logAdminAction({ actor: getActorFromRequest(request), request,
      action: 'handoff.price_reviewed', entityType: 'handoff', entityId: body.id,
      entityLabel: data.phone, summary: `Revisión manual de cotización: $${price}`,
      changes: { tommyPriceReview: { from: previous, to: review } },
    })
    return NextResponse.json({ success: true, review })
  } catch (error) {
    console.error('[Handoff price review]', error)
    return NextResponse.json({ error: 'No fue posible guardar el precio revisado' }, { status: 500 })
  }
}
