import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { sanitizeQuoteState } from '@/lib/quoteState'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Una cotización para abrirla y EDITARLA en el cotizador interno (Francisco, 20-10-2026):
 * la de la web o la del panel, con sus datos y sus artículos.
 *
 * Las cotizaciones desde oct-2026 guardan el estado completo (`quote_state`) y se abren tal
 * cual. Las anteriores solo tienen la lista de artículos (`items_summary`) y las direcciones
 * en texto: se abren con los datos del cliente, la fecha y los artículos (los que tienen el
 * nombre de un artículo del catálogo vuelven con su peso y volumen; el resto, con su
 * volumen), y las direcciones hay que volver a elegirlas para calcular el precio.
 */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  if (!UUID_RE.test(params.id)) return NextResponse.json({ error: 'Cotización no encontrada' }, { status: 404 })
  const { data: p } = await supabaseAdmin.from('quote_prospects').select('*').eq('id', params.id).maybeSingle()
  if (!p) return NextResponse.json({ error: 'Cotización no encontrada' }, { status: 404 })
  if (p.source === 'domicilio' || p.visit_address) {
    return NextResponse.json({ error: 'Las visitas a domicilio no se editan en el cotizador.' }, { status: 409 })
  }

  const full = sanitizeQuoteState(p.quote_state)
  let items = full?.items || []
  if (!full) {
    const summary = (Array.isArray(p.items_summary) ? p.items_summary : []) as any[]
    const { data: catalog } = await supabaseAdmin.from('catalog_items').select('*')
    const byName = new Map(((catalog || []) as any[]).map((c) => [String(c.name).trim().toLowerCase(), c]))
    items = summary
      .filter((it) => it && it.name)
      .map((it, i) => {
        const quantity = Math.max(1, Math.round(Number(it.quantity) || 1))
        const c = byName.get(String(it.name).trim().toLowerCase())
        return c
          ? {
              id: c.id,
              name: c.name,
              category: c.category,
              volume: Number(c.volume) || 0,
              weight: Number(c.weight) || 0,
              quantity,
              isFragile: Boolean(c.is_fragile),
              isHeavy: Boolean(c.is_heavy),
              isGlass: Boolean(c.is_glass),
              image: c.image,
              ...(it.packaging ? { packaging: it.packaging } : {}),
            }
          : {
              id: `anterior-${i}`,
              name: String(it.name),
              category: 'Otros',
              volume: Math.round(((Number(it.volume) || 0) / quantity) * 10_000) / 10_000,
              weight: 0,
              quantity,
              isFragile: false,
              isHeavy: false,
              isGlass: false,
              ...(it.packaging ? { packaging: it.packaging } : {}),
            }
      })
  }

  const { data: booking } = p.converted_booking_id
    ? await supabaseAdmin.from('bookings').select('id, code, payment_status, is_provisional').eq('id', p.converted_booking_id).maybeSingle()
    : { data: null }

  return NextResponse.json({
    prospectId: p.id,
    quoteId: p.quote_id,
    hasFullState: Boolean(full),
    personalInfo: {
      name: p.name || '',
      email: p.email || '',
      phone: p.phone || '',
      isCompany: Boolean(p.is_company),
      ...(p.is_company ? { companyName: p.company_name || '', companyRut: p.company_rut || '' } : {}),
    },
    // La fecha y hora como texto: el navegador arma la fecha local (Chile).
    scheduledDate: p.scheduled_date || null,
    scheduledTime: p.scheduled_time ? String(p.scheduled_time).slice(0, 5) : null,
    state: full
      ? { ...full, items }
      : {
          isFlexible: Boolean(p.is_flexible),
          origin: { address: null, details: null },
          destination: { address: null, details: null },
          stops: [],
          items,
          additionalServices: {
            disassembly: Boolean(p.additional_services?.disassembly),
            assembly: Boolean(p.additional_services?.assembly),
            packing: Boolean(p.additional_services?.packing),
            unpacking: Boolean(p.additional_services?.unpacking),
            observations: p.additional_services?.observations || '',
            photos: [],
            extraHelpers: Number(p.additional_services?.extraHelpers) || 0,
          },
        },
    // Direcciones en texto de una cotización antigua, para tenerlas a la vista al reelegirlas.
    previousAddresses: full ? null : { origin: p.origin_address || null, destination: p.destination_address || null },
    finalPrice: Number(p.adjusted_price) || Number(p.total_price) || null,
    note: p.adjustment_comment || '',
    booking: booking ? { code: booking.code, paid: booking.payment_status === 'approved' || booking.is_provisional === false } : null,
  })
}
