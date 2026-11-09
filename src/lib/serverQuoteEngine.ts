import { rawQuoteGaps } from '@/lib/whatsapp/rawNlpQuote'
import jsPDF from 'jspdf'
import { supabaseAdmin } from '@/lib/supabase'
import { MAPS_CONFIG } from '@/config/maps'
import type { QuoteSessionRow, QuoteSessionState } from '@/lib/quoteSession'
import { calculateQuote } from '@/lib/quotePricing'
import { readPricingConfig } from '@/lib/server/pricingConfigServer'
import { geocodeAddressServer, segmentDistanceServer } from '@/lib/server/geoapifyServer'
import { routeDistanceWith, type RoutePoint } from '@/lib/routeDistance'
import { upsertQuoteProspect } from '@/lib/server/quoteProspects'
import { siteBaseUrl, toHiddenFileUrl } from '@/lib/fileLinks'
import { loadQuotePhoto } from '@/lib/whatsapp/photoStorage'

interface CatalogRow {
  id: string | number
  name: string
  volume: number | string
  weight: number | string
  is_fragile: boolean | null
  is_glass: boolean | null
  is_heavy: boolean | null
  category?: string | null
}

export interface ServerQuoteResult {
  quoteId: string
  estimatedPrice: number
  totalVolume: number
  totalWeight: number
  totalDistance: number
  recommendedVehicle: string
  items: Array<{ id: string; name: string; category: string; quantity: number; volume: number; weight: number; isHeavy: boolean; isFragile: boolean; isGlass: boolean }>
  prospectId: string
  pdfUrl: string
  pdfFileName: string
}

function addressText(address: QuoteSessionState['origin']['address']) {
  return [address.street, address.number, address.commune, address.region, 'Chile'].filter(Boolean).join(', ')
}

/**
 * Distancia de la ruta con las mismas reglas del cotizador web (`/api/quote/calculate`):
 * misma geocodificación con guarda de región y misma distancia por defecto si algo falla.
 */
async function calculateDistance(state: QuoteSessionState) {
  const point = (address: QuoteSessionState['origin']['address']): RoutePoint | null =>
    address.street && address.commune
      ? { street: address.street, number: address.number || '', commune: address.commune, region: address.region || '' }
      : null
  const points = [point(state.origin.address), ...(state.stops || []).map(point), point(state.destination.address)].filter((p): p is RoutePoint => p !== null)
  return routeDistanceWith(points, {
    geocode: async (p) => {
      const r = await geocodeAddressServer(p)
      return r.ok ? { lat: r.lat, lng: r.lng } : null
    },
    segmentKm: async (a, b) => {
      const r = await segmentDistanceServer(a.lat, a.lng, b.lat, b.lng)
      return r.ok ? r.kilometers : null
    },
    defaultDistance: MAPS_CONFIG.defaultDistance,
  })
}

/** Cotiza el estado de una sesión. Solo lee (catálogo, precios, distancia): no guarda nada. */
export async function calculateSessionQuote(state: QuoteSessionState) {
  const ids = state.items.map((item) => item.catalogItemId)
  const { data: rows, error } = await supabaseAdmin
    .from('catalog_items')
    .select('id,name,category,volume,weight,is_heavy,is_fragile,is_glass,is_active')
    .in('id', ids)
    .eq('is_active', true)
  if (error) throw new Error(error.message)

  const byId = new Map<string, CatalogRow>((rows || []).map((row: any) => [String(row.id), row as CatalogRow]))
  const items = state.items
    .map((selected) => {
      const row = byId.get(selected.catalogItemId)
      if (!row) return null
      return {
        id: String(row.id),
        name: row.name,
        category: row.category || '',
        quantity: selected.quantity,
        volume: Number(row.volume),
        weight: Number(row.weight),
        isHeavy: Boolean(row.is_heavy),
        isFragile: Boolean(row.is_fragile),
        isGlass: Boolean(row.is_glass),
      }
    })
    .filter(Boolean) as ServerQuoteResult['items']

  if (!items.length) throw new Error('El inventario no contiene items válidos del catálogo')

  // EL PRECIO NO SE CALCULA ACÁ. Se arma el contexto (configuración vigente del panel +
  // distancia real) y se llama a `calculateQuote`, la única fórmula del sistema: la misma
  // del cotizador web. Así una cotización por WhatsApp da el mismo valor que en la web y
  // sigue cualquier cambio que se haga en Configuración → Precios.
  const [pricing, totalDistance] = await Promise.all([readPricingConfig(), calculateDistance(state)])
  // «No se usarán escaleras» no implica «hay ascensor», pero sí significa
  // que NO corresponde cobrar un recargo por escaleras en esta cotización preliminar.
  const result = calculateQuote({
    items,
    origin: { floor: state.origin.details.floor ?? undefined, hasElevator: state.origin.details.hasElevator ?? undefined },
    destination: { floor: state.destination.details.floor ?? undefined, hasElevator: state.destination.details.hasElevator ?? undefined },
    distanceKm: totalDistance,
    dateTime: state.schedule.date && state.schedule.time ? `${state.schedule.date}T${state.schedule.time}:00` : null,
    isFlexible: state.schedule.isFlexible,
    isCompany: state.personalInfo.isCompany,
    additionalServices: { disassembly: state.additionalServices.disassembly, assembly: state.additionalServices.assembly,
      packing: state.additionalServices.packing, unpacking: state.additionalServices.unpacking,
      extraHelpers: state.additionalServices.extraHelpers ?? 0, fridgeDisassembly: state.additionalServices.fridgeDisassembly ?? false,
      priority: state.additionalServices.priority ?? false },
    pricing,
  })

  return {
    estimatedPrice: result.estimatedPrice,
    totalVolume: Math.round(result.totalVolume * 100) / 100,
    totalWeight: Math.round(result.totalWeight * 100) / 100,
    totalDistance,
    priceBreakdown: result.priceBreakdown,
    recommendedVehicle: result.recommendedVehicle,
    requiredCrew: result.requiredCrew,
    totalCrew: result.totalCrew,
    items,
  }
}

function generateQuotePdfBuffer(state: QuoteSessionState, quote: Awaited<ReturnType<typeof calculateSessionQuote>>, quoteId: string, photos: string[] = []) {
  const pdf = new jsPDF('p', 'mm', 'a4')
  const width = pdf.internal.pageSize.getWidth()
  const money = (amount: number) => `$${amount.toLocaleString('es-CL')}`
  let y = 46

  const drawHeader = (continuation = false) => {
    pdf.setFillColor(111, 168, 220)
    pdf.rect(0, 0, width, continuation ? 25 : 38, 'F')
    pdf.setTextColor(255, 255, 255)
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(continuation ? 14 : 21)
    pdf.text('COTIZACION DE MUDANZA', width / 2, continuation ? 15 : 15, { align: 'center' })
    if (!continuation) {
      pdf.setFont('helvetica', 'normal')
      pdf.setFontSize(10)
      pdf.text(`Yo Me Encargo - ${quoteId}`, width / 2, 25, { align: 'center' })
      pdf.text(`Emitida: ${new Date().toLocaleDateString('es-CL')}`, width / 2, 32, { align: 'center' })
    }
    pdf.setTextColor(20, 20, 20)
  }
  const ensureSpace = (needed = 9) => {
    if (y + needed <= 265) return
    pdf.addPage()
    drawHeader(true)
    y = 34
  }
  const section = (title: string) => {
    ensureSpace(19)
    y += 3
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(12.5)
    pdf.text(title, 18, y)
    y += 7
  }
  const line = (text: string, indent = 18, fontSize = 9.5, bold = false) => {
    pdf.setFont('helvetica', bold ? 'bold' : 'normal')
    pdf.setFontSize(fontSize)
    const wrapped = pdf.splitTextToSize(text, width - indent - 18) as string[]
    for (const part of wrapped) {
      ensureSpace(5.3)
      pdf.text(part, indent, y)
      y += 5.3
    }
  }
  const access = (endpoint: 'origin' | 'destination') => {
    const details = state[endpoint].details
    const label = endpoint === 'origin' ? 'Origen' : 'Destino'
    const floor = details.floor === null ? 'Sin informar' : `${details.floor}° piso`
    const elevator = details.hasElevator === null ? 'Sin confirmar' : (details.hasElevator ? 'Sí' : 'No')
    const carry = details.parkingDistance === null ? 'Sin informar' : `${details.parkingDistance} m`
    line(`${label}: ${floor} | Ascensor: ${elevator} | Acarreo: ${carry}`)
  }

  drawHeader()
  section('Cliente')
  line(`Nombre: ${state.personalInfo.name || 'No informado'} | Teléfono: ${state.personalInfo.phone || 'No informado'}`)
  line(`Correo: ${state.personalInfo.email || 'No informado'} | Documento: ${state.taxDocument || 'Por definir'}`)

  section('Mudanza')
  line(`Fecha: ${state.schedule.date || 'Por confirmar'} | Hora: ${state.schedule.time || 'Por confirmar'}`)
  line(`Origen: ${addressText(state.origin.address)}`)
  line(`Destino: ${addressText(state.destination.address)}`)
  for (const [index,stop] of (state.stops || []).entries()) line(`Parada ${index+1}: ${[stop.street,stop.number,stop.commune,stop.region].filter(Boolean).join(', ')}${stop.note ? ` - ${stop.note}` : ''}`)
  line(`Distancia de ruta: ${quote.totalDistance.toFixed(2)} km`)

  section('Accesos y servicios')
  access('origin')
  access('destination')
  const responses = state.intake?.tommyDetails
  if (responses?.escaleras) line(`Escaleras declaradas: ${responses.escaleras}`)
  if ([state.origin, state.destination].some((p) => (p.details.floor || 0) > 0 && p.details.hasElevator === false)) {
    line('Recargo de escaleras según pisos declarados y ausencia de ascensor.', 18, 8.5)
  }
  if (responses?.acarreo) line(`Distancia de carga declarada: ${responses.acarreo}`)
  const packDetail = responses?.embalaje || ''
  const observations = state.additionalServices.observations === '__pending__' ? '' : (state.additionalServices.observations || '')
  const packingDescription = state.additionalServices.packing
    ? `Sí${packDetail && packDetail !== 'Sí' ? ` - ${packDetail}` : observations ? ` - ${observations}` : ''}`
    : 'No'
  line(`Embalaje: ${packingDescription}`)
  line(`Desarmado: ${state.additionalServices.disassembly ? 'Sí' : 'No'} | Armado: ${state.additionalServices.assembly ? 'Sí' : 'No'} | Desembalaje: ${state.additionalServices.unpacking ? 'Sí' : 'No'}`)
  line(`Ayudantes adicionales: ${state.additionalServices.extraHelpers ?? 0} | Desarmado de refrigerador: ${state.additionalServices.fridgeDisassembly ? 'Sí' : 'No'} | Prioritario: ${state.additionalServices.priority ? 'Sí' : 'No'}`)
  line(`Bultos por escalera fuera del ascensor: ${state.additionalServices.stairsCarry ? 'Sí' : 'No'} | Fecha flexible: ${state.schedule.isFlexible ? 'Sí' : 'No'}`)
  line(`Origen: ${state.origin.details.propertyType || 'Sin informar'} | Destino: ${state.destination.details.propertyType || 'Sin informar'}`)

  section('Inventario')
  for (const item of quote.items) {
    line(`${item.quantity} x ${item.name} - ${(item.volume * item.quantity).toFixed(2)} m³`, 20, 9)
  }
  line(`Volumen total: ${quote.totalVolume.toFixed(2)} m³ | Peso total: ${quote.totalWeight.toFixed(0)} kg`, 18, 9.5, true)
  line(`Vehículo sugerido: ${quote.recommendedVehicle}`)
  line(`Cuadrilla estimada: ${quote.totalCrew} persona(s)`)

  section('Desglose del precio estimado')
  line('Importes calculados con las tarifas vigentes. Los cargos de valor $0 se muestran para mayor claridad.', 18, 8.5)
  let total = 0
  for (const component of quote.priceBreakdown) {
    total += component.amount
    line(`${component.label}: ${money(component.amount)}`, 20, 9)
  }
  if (total !== quote.estimatedPrice) throw new Error('La suma de partidas no coincide con el precio estimado')
  ensureSpace(20)
  y += 3
  pdf.setDrawColor(180, 180, 180)
  pdf.line(18, y, width - 18, y)
  y += 9
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(17)
  pdf.setTextColor(63, 98, 18)
  pdf.text(`TOTAL ESTIMADO: ${money(quote.estimatedPrice)}`, 18, y)
  y += 9
  pdf.setTextColor(20, 20, 20)
  line('Las distancias de acarreo se registran como antecedente: la fórmula actual no les aplica un cargo independiente.', 18, 8)
  line('Sujeto a revisión humana de volumen, accesos, embalaje, disponibilidad y condiciones reales.', 18, 8)

  // Anexos del expediente: incluir hasta 12 fotografías del inventario sin alterar
  // precios, kilometraje, ni la integración de prospectos que mantiene el template.
  if (photos.length) {
    pdf.addPage()
    pdf.setTextColor(20, 20, 20)
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(15)
    pdf.text('Registro fotográfico del inventario', 18, 18)
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(9)
    pdf.text('Fotografías originales aportadas por el cliente (referenciales).', 18, 25)
    let photoY = 34
    for (let i = 0; i < photos.length; i++) {
      if (i > 0 && i % 6 === 0) {
        pdf.addPage()
        photoY = 26
      }
      if (i > 0 && i % 2 === 0 && i % 6 !== 0) photoY += 76
      const x = 18 + (i % 2) * 92
      try {
        const format = photos[i].startsWith('data:image/png') ? 'PNG' : photos[i].startsWith('data:image/webp') ? 'WEBP' : 'JPEG'
        pdf.addImage(photos[i], format, x, photoY, 80, 62, undefined, 'FAST')
        pdf.setFontSize(9)
        pdf.text(`Fotografía ${i + 1}`, x, photoY + 67)
      } catch {
        // El almacenamiento mantiene el original aunque el PDF no pueda dibujarlo.
        pdf.text(`Fotografía ${i + 1}: archivo conservado en el expediente`, x, photoY + 10, { maxWidth: 80 })
      }
    }
  }

  // Pie estable en todas las páginas, sin tapar el desglose.
  const pages = pdf.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    pdf.setPage(i)
    pdf.setDrawColor(225, 225, 225)
    pdf.line(18, 276, width - 18, 276)
    pdf.setTextColor(110, 110, 110)
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(8)
    pdf.text('Yo Me Encargo - Cotización preliminar sujeta a revisión humana', 18, 282)
    pdf.text(`${i}/${pages}`, width - 18, 282, { align: 'right' })
  }
  return Buffer.from(pdf.output('arraybuffer'))
}

/**
 * El prospecto se guarda por `upsertQuoteProspect`, la misma función de la web y del panel:
 * misma identidad por correo, mismo `lead_key`, mismos campos. Solo cambia el origen.
 */
async function upsertProspect(state: QuoteSessionState, quoteId: string, quote: Awaited<ReturnType<typeof calculateSessionQuote>>) {
  const { prospect } = await upsertQuoteProspect({
    source: 'whatsapp',
    quote_id: quoteId,
    name: state.personalInfo.name,
    email: state.personalInfo.email,
    phone: state.personalInfo.phone,
    is_company: state.personalInfo.isCompany,
    company_name: state.personalInfo.companyName,
    company_rut: state.personalInfo.companyRut,
    // Igual que la web: calle, número, comuna y región, sin el país.
    origin_address: addressText(state.origin.address).replace(/, Chile$/, ''),
    stops: state.stops || [],
    destination_address: addressText(state.destination.address).replace(/, Chile$/, ''),
    origin_floor: state.origin.details.floor,
    origin_has_elevator: state.origin.details.hasElevator,
    origin_parking_distance: state.origin.details.parkingDistance,
    destination_floor: state.destination.details.floor,
    destination_has_elevator: state.destination.details.hasElevator,
    destination_parking_distance: state.destination.details.parkingDistance,
    scheduled_date: state.schedule.date,
    scheduled_time: state.schedule.time,
    total_price: quote.estimatedPrice,
    original_price: state.schedule.isFlexible ? Math.round(quote.estimatedPrice / 0.9) : quote.estimatedPrice,
    is_flexible: state.schedule.isFlexible,
    recommended_vehicle: quote.recommendedVehicle,
    total_volume: quote.totalVolume,
    total_weight: quote.totalWeight,
    total_distance: quote.totalDistance,
    items_summary: quote.items.map((item) => ({
      name: item.name,
      quantity: item.quantity,
      volume: parseFloat((item.volume * item.quantity).toFixed(2)),
    })),
    quote_state: {
      v: 1,
      dateTime: state.schedule.date ? `${state.schedule.date}T${state.schedule.time || '12:00'}:00` : null,
      isFlexible: state.schedule.isFlexible,
      origin: { address: state.origin.address, details: state.origin.details },
      destination: { address: state.destination.address, details: state.destination.details },
      stops: state.stops || [],
      items: quote.items.map((item) => ({ id: item.id, name: item.name, volume: item.volume,
        weight: item.weight, quantity: item.quantity, category: item.category,
        isHeavy: item.isHeavy, isFragile: item.isFragile, isGlass: item.isGlass })),
      additionalServices: { ...state.additionalServices,
        observations: state.additionalServices.observations === '__pending__' ? '' : state.additionalServices.observations },
    },
    additional_services: {
      disassembly: state.additionalServices.disassembly,
      assembly: state.additionalServices.assembly,
      packing: state.additionalServices.packing,
      unpacking: state.additionalServices.unpacking,
      observations: state.additionalServices.observations === '__pending__' ? '' : state.additionalServices.observations,
      extraHelpers: state.additionalServices.extraHelpers || 0,
      fridgeDisassembly: state.additionalServices.fridgeDisassembly || false,
      priority: state.additionalServices.priority || false,
      stairsCarry: state.additionalServices.stairsCarry || false,
      requiredCrew: quote.requiredCrew,
      totalCrew: quote.totalCrew,
    },
  })
  return prospect.id as string
}

async function uploadPdf(buffer: Buffer, prospectId: string, quoteId: string) {
  const fileName = `Cotizacion_WhatsApp_${quoteId}.pdf`
  const filePath = `prospect-pdfs/whatsapp_${prospectId}_${Date.now()}.pdf`
  const { error } = await supabaseAdmin.storage.from('bookings').upload(filePath, buffer, {
    contentType: 'application/pdf',
    upsert: true,
  })
  if (error) throw new Error(error.message)
  const { data } = supabaseAdmin.storage.from('bookings').getPublicUrl(filePath)
  const pdfUrl = data.publicUrl
  await supabaseAdmin.from('quote_prospects').update({ pdf_url: pdfUrl, pdf_generated_at: new Date().toISOString() }).eq('id', prospectId)
  return { pdfUrl, fileName }
}

export async function generateQuoteFromSession(session: QuoteSessionRow): Promise<ServerQuoteResult> {
  const state = session.state
  if (!state.personalInfo.name || !state.personalInfo.email || !state.schedule.date || !state.schedule.time) {
    throw new Error('La sesión todavía no tiene los datos mínimos para cotizar')
  }

  const quote = await calculateSessionQuote(state)
  const quoteId = session.quote_id || `YME-WA-${Date.now().toString(36).toUpperCase()}`
  const prospectId = await upsertProspect(state, quoteId, quote)
  const photoPaths = (state.inventoryPhotos || []).filter((photo) => photo.storagePath).map((photo) => photo.storagePath!)
  const photoData = (await Promise.all(photoPaths.slice(0, 12).map(loadQuotePhoto))).filter((value): value is string => Boolean(value))
  const buffer = generateQuotePdfBuffer(state, quote, quoteId, photoData)
  const { pdfUrl, fileName } = await uploadPdf(buffer, prospectId, quoteId)

  await supabaseAdmin
    .from('quote_sessions')
    .update({
      status: 'quoted',
      quote_id: quoteId,
      prospect_id: prospectId,
      estimated_price: quote.estimatedPrice,
      total_volume: quote.totalVolume,
      total_weight: quote.totalWeight,
      total_distance: quote.totalDistance,
      recommended_vehicle: quote.recommendedVehicle,
      pdf_url: pdfUrl,
      updated_at: new Date().toISOString(),
    })
    .eq('id', session.id)

  // Meta descarga el PDF desde este enlace: va por el dominio del sitio, no por el almacenamiento.
  return { quoteId, prospectId, pdfUrl: toHiddenFileUrl(pdfUrl, siteBaseUrl() || 'https://yomeencargo.cl'), pdfFileName: fileName, ...quote }
}

/**
 * PDF estimativo de los seis datos de Tommy. No exige nombre, correo, boleta o
 * una hora que el cliente nunca proporcionó. Guarda la cotización en la sesión
 * de WhatsApp ya existente; no crea tickets en handoff_requests ni prospectos
 * sin identidad verificable. El generador antiguo sigue disponible para fichas
 * completas del cotizador web.
 */
export async function generatePreliminaryWhatsAppQuote(session: QuoteSessionRow): Promise<ServerQuoteResult> {
  const state = session.state
  const missing = rawQuoteGaps(state)
  if (missing.length) throw new Error(`No se genera PDF con variables sin contestar: ${missing.join(', ')}`)
  const quote = await calculateSessionQuote(state)
  if (!Number.isFinite(quote.estimatedPrice) || quote.estimatedPrice <= 0) {
    throw new Error('El cálculo no devolvió un precio estimativo válido')
  }
  const quoteId = session.quote_id || `YME-WA-${Date.now().toString(36).toUpperCase()}`
  const prospectId = await upsertProspect(state, quoteId, quote)
  const photoPaths = (state.inventoryPhotos || []).filter((photo) => photo.storagePath).map((photo) => photo.storagePath!)
  const photoData = (await Promise.all(photoPaths.slice(0, 12).map(loadQuotePhoto))).filter((value): value is string => Boolean(value))
  const pdf = generateQuotePdfBuffer(state, quote, quoteId, photoData)
  const fileName = `Cotizacion_WhatsApp_${quoteId}.pdf`
  const path = `prospect-pdfs/whatsapp_preliminar_${session.id}_${Date.now()}.pdf`
  const { error: uploadError } = await supabaseAdmin.storage.from('bookings').upload(path, pdf, {
    contentType: 'application/pdf', upsert: true,
  })
  if (uploadError) throw new Error(`No se pudo guardar el PDF estimativo: ${uploadError.message}`)
  const pdfUrl = supabaseAdmin.storage.from('bookings').getPublicUrl(path).data.publicUrl
  const { error: saveError } = await supabaseAdmin.from('quote_sessions').update({
    status: 'quoted', quote_id: quoteId, prospect_id: prospectId, estimated_price: quote.estimatedPrice,
    total_volume: quote.totalVolume, total_weight: quote.totalWeight,
    total_distance: quote.totalDistance, recommended_vehicle: quote.recommendedVehicle,
    pdf_url: pdfUrl,
    state: { ...state, intake: { ...state.intake!, tommySubmittedAt: new Date().toISOString() } },
    updated_at: new Date().toISOString(),
  }).eq('id', session.id)
  if (saveError) throw new Error(`PDF generado, pero no se pudo cerrar la sesión: ${saveError.message}`)
  return {
    quoteId, prospectId, pdfUrl: toHiddenFileUrl(pdfUrl, siteBaseUrl() || 'https://yomeencargo.cl'),
    pdfFileName: fileName, ...quote,
  }
}
