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
}

export interface ServerQuoteResult {
  quoteId: string
  estimatedPrice: number
  totalVolume: number
  totalWeight: number
  totalDistance: number
  recommendedVehicle: string
  items: Array<{ id: string; name: string; quantity: number; volume: number; weight: number; isFragile: boolean; isGlass: boolean }>
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
  const points = [point(state.origin.address), point(state.destination.address)].filter((p): p is RoutePoint => p !== null)
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
    .select('id,name,volume,weight,is_fragile,is_glass,is_active')
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
        quantity: selected.quantity,
        volume: Number(row.volume),
        weight: Number(row.weight),
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
  const result = calculateQuote({
    items,
    origin: { floor: state.origin.details.floor ?? undefined, hasElevator: state.origin.details.hasElevator ?? undefined },
    destination: { floor: state.destination.details.floor ?? undefined, hasElevator: state.destination.details.hasElevator ?? undefined },
    distanceKm: totalDistance,
    dateTime: state.schedule.date && state.schedule.time ? `${state.schedule.date}T${state.schedule.time}:00` : null,
    isFlexible: state.schedule.isFlexible,
    isCompany: state.personalInfo.isCompany,
    additionalServices: { disassembly: state.additionalServices.disassembly, assembly: state.additionalServices.assembly,
      packing: state.additionalServices.packing, unpacking: state.additionalServices.unpacking },
    pricing,
  })

  return {
    estimatedPrice: result.estimatedPrice,
    totalVolume: Math.round(result.totalVolume * 100) / 100,
    totalWeight: Math.round(result.totalWeight * 100) / 100,
    totalDistance,
    recommendedVehicle: result.recommendedVehicle,
    requiredCrew: result.requiredCrew,
    totalCrew: result.totalCrew,
    items,
  }
}

function generateQuotePdfBuffer(state: QuoteSessionState, quote: Awaited<ReturnType<typeof calculateSessionQuote>>, quoteId: string, photos: string[] = []) {
  const pdf = new jsPDF('p', 'mm', 'a4')
  const width = pdf.internal.pageSize.getWidth()
  let y = 18

  pdf.setFillColor(111, 168, 220)
  pdf.rect(0, 0, width, 38, 'F')
  pdf.setTextColor(255, 255, 255)
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(22)
  pdf.text('COTIZACION DE MUDANZA', width / 2, 15, { align: 'center' })
  pdf.setFontSize(11)
  pdf.setFont('helvetica', 'normal')
  pdf.text(`Yo Me Encargo · ${quoteId}`, width / 2, 25, { align: 'center' })
  pdf.text(`Emitida: ${new Date().toLocaleDateString('es-CL')}`, width / 2, 32, { align: 'center' })

  y = 50
  pdf.setTextColor(20, 20, 20)
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(14)
  pdf.text('Cliente', 18, y)
  y += 8
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(10)
  pdf.text(`Nombre: ${state.personalInfo.name || 'No informado'}`, 18, y); y += 6
  pdf.text(`Email: ${state.personalInfo.email || 'No informado'}`, 18, y); y += 6
  pdf.text(`Telefono: ${state.personalInfo.phone}`, 18, y); y += 6
  pdf.text(`Documento solicitado: ${state.taxDocument || 'Por definir'}`, 18, y); y += 9

  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(14)
  pdf.text('Mudanza', 18, y); y += 8
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(10)
  pdf.text(`Fecha: ${state.schedule.date || 'Por confirmar'} · Hora: ${state.schedule.time || 'Por confirmar'}`, 18, y); y += 6
  pdf.text(`Origen: ${addressText(state.origin.address)}`, 18, y, { maxWidth: 175 }); y += 8
  pdf.text(`Destino: ${addressText(state.destination.address)}`, 18, y, { maxWidth: 175 }); y += 8
  pdf.text(`Distancia estimada: ${quote.totalDistance} km`, 18, y); y += 6
  pdf.text(`Acarreo en retiro: ${state.origin.details.parkingDistance ?? 'Sin dato'} m del camión a la puerta`, 18, y); y += 6
  pdf.text(`Acarreo en entrega: ${state.destination.details.parkingDistance ?? 'Sin dato'} m del camión a la puerta`, 18, y); y += 9

  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(14)
  pdf.text('Inventario', 18, y); y += 7
  pdf.setFontSize(9)
  pdf.setFont('helvetica', 'normal')
  for (const item of quote.items) {
    if (y > 250) { pdf.addPage(); y = 20 }
    pdf.text(`${item.quantity} x ${item.name} · ${(item.volume * item.quantity).toFixed(2)} m3`, 20, y)
    y += 5.5
  }

  y += 4
  pdf.setDrawColor(220, 220, 220)
  pdf.line(18, y, width - 18, y)
  y += 9
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(12)
  pdf.text(`Volumen estimado: ${quote.totalVolume.toFixed(2)} m3`, 18, y); y += 7
  pdf.text(`Peso estimado: ${quote.totalWeight.toFixed(0)} kg`, 18, y); y += 7
  pdf.text(`Vehiculo sugerido: ${quote.recommendedVehicle}`, 18, y); y += 9
  pdf.setFontSize(20)
  pdf.setTextColor(63, 98, 18)
  pdf.text(`Precio estimado: $${quote.estimatedPrice.toLocaleString('es-CL')}`, 18, y)

  pdf.setTextColor(80, 80, 80)
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(8)
  pdf.text('Valor estimativo sujeto a validacion de volumen, accesos, disponibilidad y condiciones reales del servicio.', 18, 282, { maxWidth: 175 })
  pdf.text('Afina los detalles de tu mudanza con nuestro ejecutivo en WhatsApp: +56 9 5439 0267', 18, 288, { maxWidth: 175 })

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
      stops: [],
      items: quote.items.map((item) => ({ id: item.id, name: item.name, volume: item.volume,
        weight: item.weight, quantity: item.quantity, isFragile: item.isFragile, isGlass: item.isGlass })),
      additionalServices: { ...state.additionalServices },
    },
    additional_services: {
      disassembly: state.additionalServices.disassembly,
      assembly: state.additionalServices.assembly,
      packing: state.additionalServices.packing,
      unpacking: state.additionalServices.unpacking,
      observations: state.additionalServices.observations === '__pending__' ? '' : state.additionalServices.observations,
      extraHelpers: 0,
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
  if (!state.origin.address.street || !state.destination.address.street || !state.schedule.date || !state.items.length || state.pendingInventory.length) {
    throw new Error('Faltan direcciones, fecha o inventario para calcular el precio estimativo')
  }
  const quote = await calculateSessionQuote(state)
  if (!Number.isFinite(quote.estimatedPrice) || quote.estimatedPrice <= 0) {
    throw new Error('El cálculo no devolvió un precio estimativo válido')
  }
  const quoteId = session.quote_id || `YME-WA-${Date.now().toString(36).toUpperCase()}`
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
    status: 'quoted', quote_id: quoteId, estimated_price: quote.estimatedPrice,
    total_volume: quote.totalVolume, total_weight: quote.totalWeight,
    total_distance: quote.totalDistance, recommended_vehicle: quote.recommendedVehicle,
    pdf_url: pdfUrl,
    state: { ...state, intake: { ...state.intake!, tommySubmittedAt: new Date().toISOString() } },
    updated_at: new Date().toISOString(),
  }).eq('id', session.id)
  if (saveError) throw new Error(`PDF generado, pero no se pudo cerrar la sesión: ${saveError.message}`)
  return {
    quoteId, prospectId: '', pdfUrl: toHiddenFileUrl(pdfUrl, siteBaseUrl() || 'https://yomeencargo.cl'),
    pdfFileName: fileName, ...quote,
  }
}
