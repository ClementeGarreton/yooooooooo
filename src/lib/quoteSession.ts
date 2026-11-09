import crypto from 'crypto'
import { supabaseAdmin } from '@/lib/supabase'
import { nextPropertyQuestion } from '@/lib/whatsapp/propertyFlow'
import { extrasQuestion, type ExtrasStep } from '@/lib/whatsapp/extrasFlow'
import type { TommyAccess } from '@/lib/whatsapp/tommyAccess'

export type PropertyType = 'casa' | 'departamento' | 'oficina' | 'bodega' | 'otro'

export interface QuoteSessionState {
  /** Captura conversacional en JSONB: compatible con sesiones anteriores. */
  intake?: { stage: 'describe' | 'review'; serviceAnswers: Array<'packing' | 'disassembly' | 'assembly' | 'unpacking'>; tommyVersion?: 1; tommyAnswers?: Array<'escaleras' | 'acarreo' | 'embalaje'>; tommyDetails?: Partial<Record<'escaleras' | 'acarreo' | 'embalaje', string>>; tommyAccess?: TommyAccess; tommySubmittedAt?: string; nlpQuestionCount?: number; nlpLastRaw?: string; answeredQuoteFields?: string[] }
  personalInfo: {
    name: string | null
    email: string | null
    phone: string
    isCompany: boolean
    companyName: string | null
    companyRut: string | null
  }
  schedule: {
    date: string | null
    time: string | null
    isFlexible: boolean
  }
  origin: {
    address: {
      street: string | null
      number: string | null
      commune: string | null
      region: string | null
      additionalInfo: string | null
    }
    details: {
      propertyType: PropertyType | null
      floor: number | null
      hasElevator: boolean | null
      parkingDistance: number | null
    }
  }
  destination: {
    address: {
      street: string | null
      number: string | null
      commune: string | null
      region: string | null
      additionalInfo: string | null
    }
    details: {
      propertyType: PropertyType | null
      floor: number | null
      hasElevator: boolean | null
      parkingDistance: number | null
    }
  }
  taxDocument?: 'boleta' | 'factura' | null
  stops?: Array<{ street: string; number: string; commune: string; region: string; additionalInfo: string; note: string }>
  items: Array<{ catalogItemId: string; quantity: number }>
  /** Seguimiento por foto, dentro del state JSONB existente. No requiere migraciones. */
  inventoryPhotos?: Array<{
    messageId: string
    status: 'processing' | 'done' | 'needs_description'
    recognized: string[]
    storagePath?: string
  }>
  /** El cliente debe indicar LISTO para cerrar una tanda de fotografías. */
  inventoryCollectionDone?: boolean
  pendingInventory: Array<{
    sourceLabel: string
    quantity: number
    question: string
    suggestions: Array<{ catalogItemId: string; label: string }>
  }>
  additionalServices: {
    disassembly: boolean
    assembly: boolean
    packing: boolean
    unpacking: boolean
    observations: string
    photos: string[]
    extrasStep?: ExtrasStep
    extraHelpers?: number
    fridgeDisassembly?: boolean
    priority?: boolean
    stairsCarry?: boolean
  }
  confirmed: boolean
}

export interface QuoteSessionRow {
  id: string
  resume_token: string
  channel: 'web' | 'whatsapp'
  phone: string | null
  status: 'collecting' | 'ready' | 'quoted' | 'handoff' | 'closed'
  current_section: number
  state: QuoteSessionState
  quote_id: string | null
  prospect_id: string | null
  estimated_price: number | null
  total_volume: number | null
  total_weight: number | null
  total_distance: number | null
  recommended_vehicle: string | null
  pdf_url: string | null
  created_at: string
  updated_at: string
}

export function createEmptyQuoteState(phone: string): QuoteSessionState {
  return {
    personalInfo: {
      name: null,
      email: null,
      phone,
      isCompany: false,
      companyName: null,
      companyRut: null,
    },
    schedule: { date: null, time: null, isFlexible: false },
    origin: {
      address: { street: null, number: null, commune: null, region: null, additionalInfo: null },
      details: { propertyType: null, floor: null, hasElevator: null, parkingDistance: null },
    },
    destination: {
      address: { street: null, number: null, commune: null, region: null, additionalInfo: null },
      details: { propertyType: null, floor: null, hasElevator: null, parkingDistance: null },
    },
    taxDocument: null,
    stops: [],
    items: [],
    inventoryPhotos: [],
    inventoryCollectionDone: false,
    pendingInventory: [],
    additionalServices: {
      disassembly: false,
      assembly: false,
      packing: false,
      unpacking: false,
      observations: '',
      photos: [],
      extrasStep: 'packing',
      extraHelpers: 0,
      fridgeDisassembly: false,
      priority: false,
      stairsCarry: false,
    },
    confirmed: false,
    intake: { stage: 'describe', serviceAnswers: [], tommyVersion: 1, tommyAnswers: [], tommyDetails: {}, answeredQuoteFields: [], nlpQuestionCount: 0 },
  }
}

export function getNextSection(state: QuoteSessionState): number {
  if (!state.personalInfo.name || !state.personalInfo.email || !state.personalInfo.phone || !state.taxDocument) return 1
  if (state.personalInfo.isCompany && (!state.personalInfo.companyName || !state.personalInfo.companyRut)) return 1
  if (!state.schedule.date || !state.schedule.time) return 2

  const oa = state.origin.address
  const da = state.destination.address
  if (!oa.street || !oa.number || !oa.commune || !oa.region || !da.street || !da.number || !da.commune || !da.region) return 3

  const od = state.origin.details
  const dd = state.destination.details
  if (!od.propertyType || od.floor === null || od.hasElevator === null || od.parkingDistance === null || !dd.propertyType || dd.floor === null || dd.hasElevator === null || dd.parkingDistance === null) return 4

  if (state.items.length === 0 || state.pendingInventory.length > 0) return 5
  if (state.inventoryPhotos?.some((photo) => photo.status !== 'done')) return 5
  if (state.inventoryPhotos?.length && !state.inventoryCollectionDone) return 5
  if (state.additionalServices.observations === '__pending__') return 6
  return 7
}

export function sectionQuestion(section: number, state: QuoteSessionState): string {
  switch (section) {
    case 1:
      if (!state.personalInfo.name || !state.personalInfo.email || !state.personalInfo.phone) return `1/7 · Tus datos\n¿Cuál es tu nombre completo y correo electrónico?${state.personalInfo.phone ? ' Tu teléfono ya lo tenemos por WhatsApp.' : ' Indica también tu teléfono de contacto.'}`
      if (!state.taxDocument) return '1/7 · Documento tributario\n¿Necesitas *BOLETA* o *FACTURA*? (No cambia el precio por sí solo).'
      return '1/7 · Datos de facturación\nPara emitir factura, ¿cuál es la razón social y el RUT de la empresa?'
    case 2:
      return '2/7 · Fecha y hora\n¿Qué día y a qué hora quieres realizar la mudanza? Si tienes flexibilidad de fecha, dímelo también.'
    case 3:
      return '3/7 · Direcciones\nIndícame la dirección completa de origen y destino: calle, número, comuna y región de cada una.'
    case 4:
      return nextPropertyQuestion(state.origin.details, state.destination.details)
    case 5:
      return '5/7 · Inventario\nEscribe qué muebles y cajas quieres trasladar, indicando cuántos de cada uno.\n\n📷 También puedes adjuntar fotos para que reconozcamos los objetos. Si envías fotos, escribe *LISTO* al terminar.'
    case 6:
      return extrasQuestion(state.additionalServices)
    case 7:
      return `7/7 · Resumen\nYa tengo los datos necesarios. Responde *CONFIRMAR* para generar tu cotización automática en PDF, o dime qué dato quieres corregir.`
    default:
      return 'Cuéntame qué necesitas ajustar de tu cotización.'
  }
}

export async function createWhatsAppSession(phone: string, contactPhone?: string): Promise<QuoteSessionRow> {
  const state = createEmptyQuoteState(contactPhone === undefined ? phone : contactPhone)
  state.additionalServices.observations = '__pending__'
  const resumeToken = crypto.randomBytes(24).toString('hex')
  const { data, error } = await supabaseAdmin
    .from('quote_sessions')
    .insert({
      resume_token: resumeToken,
      channel: 'whatsapp',
      phone,
      status: 'collecting',
      current_section: 1,
      state,
    })
    .select('*')
    .single()

  if (error || !data) throw new Error(error?.message || 'No se pudo crear la sesión de cotización')
  return data as QuoteSessionRow
}

export async function getOrCreateWhatsAppSession(phone: string): Promise<QuoteSessionRow> {
  const { data: existing } = await supabaseAdmin
    .from('quote_sessions')
    .select('*')
    .eq('channel', 'whatsapp')
    .eq('phone', phone)
    .in('status', ['collecting', 'ready'])
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existing) return existing as QuoteSessionRow
  return createWhatsAppSession(phone)
}

export async function closeQuoteSession(id: string) {
  const { error } = await supabaseAdmin
    .from('quote_sessions')
    .update({ status: 'closed', updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error(`No se pudo cerrar la sesión: ${error.message}`)
}

export async function saveQuoteSession(
  id: string,
  state: QuoteSessionState,
  extra: Record<string, unknown> = {}
): Promise<QuoteSessionRow> {
  const currentSection = getNextSection(state)
  const status = currentSection === 7 ? 'ready' : 'collecting'
  const { data, error } = await supabaseAdmin
    .from('quote_sessions')
    .update({
      state,
      current_section: currentSection,
      status,
      updated_at: new Date().toISOString(),
      ...extra,
    })
    .eq('id', id)
    .select('*')
    .single()

  if (error || !data) throw new Error(error?.message || 'No se pudo actualizar la sesión')
  return data as QuoteSessionRow
}

/**
 * Actualización compare-and-swap del JSONB de la sesión.
 * Evita que varias fotos enviadas simultáneamente se sobreescriban entre sí
 * en distintas funciones serverless. Usa la misma tabla/state: cero migraciones.
 */
export async function mutateQuoteSessionAtomically(
  id: string,
  mutate: (state: QuoteSessionState) => QuoteSessionState,
): Promise<QuoteSessionRow> {
  for (let attempt = 0; attempt < 15; attempt += 1) {
    const { data: existing, error: readError } = await supabaseAdmin
      .from('quote_sessions').select('*').eq('id', id).maybeSingle()
    if (readError) throw new Error(readError.message)
    if (!existing || !['collecting', 'ready'].includes(existing.status)) {
      throw new Error('Cotización cerrada; no se puede modificar el inventario')
    }
    const current = existing as QuoteSessionRow
    const nextState = mutate(structuredClone(current.state))
    const currentSection = getNextSection(nextState)
    // El timestamp avanza al menos 1 ms, incluso en operaciones ultrarrápidas.
    const now = new Date(Math.max(Date.now(), Date.parse(current.updated_at) + 1)).toISOString()
    const { data, error } = await supabaseAdmin.from('quote_sessions')
      .update({ state: nextState, current_section: currentSection,
        status: currentSection === 7 ? 'ready' : 'collecting', updated_at: now })
      .eq('id', id)
      // Comparación atómica sobre JSONB: si otro webhook lo cambió, reintentar.
      .eq('state', JSON.stringify(current.state))
      .in('status', ['collecting', 'ready'])
      .select('*').maybeSingle()
    if (error) throw new Error(`No se pudo consolidar inventario: ${error.message}`)
    if (data) return data as QuoteSessionRow
  }
  throw new Error('Demasiados cambios simultáneos en el inventario. Reenvía el último elemento.')
}

export async function loadResumeSession(id: string, token: string): Promise<QuoteSessionRow | null> {
  const { data } = await supabaseAdmin
    .from('quote_sessions')
    .select('*')
    .eq('id', id)
    .eq('resume_token', token)
    .maybeSingle()
  return (data as QuoteSessionRow | null) || null
}
