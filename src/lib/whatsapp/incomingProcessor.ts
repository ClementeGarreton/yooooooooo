import { parseRawCustomerQuote, mergeRawQuote, rawQuoteGaps, nextShortQuestion, QUOTE_INTAKE_QUESTIONS } from '@/lib/whatsapp/rawNlpQuote'
import { QUOTE_FIRST_MESSAGE, QUOTE_PHOTO_MESSAGE, inventoryMessage, missingQuoteMessage, missingQuoteQuestions, quoteFlowStep, withQuoteFlowStep, normalizeQuoteCustomerReply, isPhotoFinish, isInventoryConfirm } from '@/lib/whatsapp/quoteConversation'
import { messageContext, conversationKey, customerPhone,
  downloadChannelImage as downloadWhatsAppMediaAsDataUrl,
  sendChannelDocument as sendWhatsAppDocument,
  sendChannelText as sendWhatsAppText,
} from '@/lib/whatsapp/messageTransport'
import {
  createWhatsAppSession,
  getOrCreateWhatsAppSession,
  closeQuoteSession,
  getNextSection,
  mutateQuoteSessionAtomically,
  saveQuoteSession,
  sectionQuestion,
  type QuoteSessionRow,
} from '@/lib/quoteSession'
import {
  findOrCreateWhatsAppConversation,
  logAction,
  logMessage,
  addUsage,
  updateConversation,
} from '@/lib/ai/conversationStore'
import {
  mergeInventory,
  parseGeneralWhatsAppTurn,
  parseWhatsAppInventory,
  pendingInventoryQuestion,
  resolvePendingInventoryChoice,
} from '@/lib/ai/whatsappQuoteAssistant'
import { generateQuoteFromSession, generatePreliminaryWhatsAppQuote } from '@/lib/serverQuoteEngine'
// La tabla handoff_requests aún no existe en producción.
// import { createHandoffRequest, collectHandoffDetails, setPendingHandoffReason } from '@/lib/whatsapp/handoffRequests'
import { TOMMY_QUOTE_START, TOMMY_FOLLOWUP, TOMMY_EXECUTIVE, tommyMissing, tommyPendingMessage, applyTommyAnswers, isTommyFormReply, isOnlyTommyServiceAnswers, tommyAnswerOnlyForAI, tommyDifferentialResult, normalizeTommyNumberedReply } from '@/lib/whatsapp/tommyFlow'
import { applyAccessForm, isTommyAccessReply } from '@/lib/whatsapp/tommyAccess'
import { saveQuotePhoto } from '@/lib/whatsapp/photoStorage'
import { canCloseInventory, isInventoryAddition, upsertInventoryPhoto } from '@/lib/whatsapp/inventoryResolution'
import { applyInventoryEdits, parseInventoryEdits, type CatalogInventoryItem } from '@/lib/whatsapp/inventoryEdits'
import { parseTaxDocumentChoice } from '@/lib/whatsapp/taxDocument'
import { answerExtras } from '@/lib/whatsapp/extrasFlow'
import { FREEFORM_START, applyLabelEdits, formatIntakeReview, formatIntakeNextPrompt, inferSinglePendingEdit, isContractClauseReply, intakeCanConfirm, nextIntakePending, ambiguousGroupedReply, markServiceAnswers, INTAKE_SERVICES } from '@/lib/whatsapp/freeformIntake'
import { getAvailableSlotsForDate } from '@/lib/scheduleAvailability'
import { supabaseAdmin } from '@/lib/supabase'
import { WHATSAPP_WELCOME, botCommand, decideBotAction, isQuoteExpired, isGreeting } from '@/lib/whatsapp/botRouter'
import { claimFirstWelcome, claimIncomingMessage, ensureBotState, moveIncomingToConversation, refreshQuoteActivity, releaseFailedWelcome, setBotMode, touchIdleActivity } from '@/lib/whatsapp/botStateStore'
import type { WhatsAppBotState } from '@/lib/whatsapp/botRouter'


const HUMAN_REQUEST = /\b(ejecutivo|persona real|humano|asesor|hablar con alguien|atenci[oó]n humana)\b/i
const CONFIRM_QUOTE = /^(confirmar|confirmo|confirmado|s[ií][,!.\s]+generar|generar cotizaci[oó]n|generar pdf)[!.\s]*$/i

function reasonFromCommand(command: ReturnType<typeof botCommand>): string | null {
  return command === 'SEGUIMIENTO' || command === 'TRABAJO' ? 'Seguimiento de servicio'
    : command === 'RECLAMO' ? 'Reclamo'
    : command === 'ASESOR' ? 'Ejecutivo' : null
}

function handoffQuestion(reason: string | null): string {
  if (reason === 'Seguimiento de servicio') return TOMMY_FOLLOWUP
  if (reason === 'Reclamo' || reason === 'Ejecutivo') return TOMMY_EXECUTIVE
  return TOMMY_EXECUTIVE
}


function normalizePhone(value: string) { return conversationKey(value) }

function extractQuoteIdFromText(text: string) {
  return text.match(/cotizaci[oó]n:\s*([^\s\n]+)/i)?.[1]?.trim() || null
}

export function extractMessages(payload: any) {
  const result: Array<{
    id: string
    from: string
    type: string
    text: string
    imageId?: string
    profileName?: string
    businessPhoneId?: string
  }> = []

  for (const entry of payload?.entry || []) {
    for (const change of entry?.changes || []) {
      const value = change?.value
      // Un mismo webhook puede recibir eventos de otros números de la aplicación.
      const businessId = String(value?.metadata?.phone_number_id || '')
      const allowedIds = [process.env.WHATSAPP_PHONE_NUMBER_ID, process.env.WHATSAPP_SECRETARY_PHONE_NUMBER_ID].filter(Boolean)
      if (!allowedIds.includes(businessId)) continue
      const nameByWaId = new Map<string, string>()
      for (const contact of value?.contacts || []) {
        if (contact?.wa_id) nameByWaId.set(String(contact.wa_id), contact?.profile?.name || '')
      }
      for (const message of value?.messages || []) {
        const from = String(message?.from || '')
        if (!from || !message?.id) continue
        const type = String(message.type || 'text')
        const text = type === 'text'
          ? String(message?.text?.body || '')
          : type === 'image'
            ? String(message?.image?.caption || '')
            : type === 'interactive'
              ? String(message?.interactive?.button_reply?.title || message?.interactive?.list_reply?.title || '')
              : ''
        result.push({
          id: String(message.id),
          from,
          type,
          text,
          imageId: type === 'image' ? String(message?.image?.id || '') : undefined,
          profileName: nameByWaId.get(from) || undefined,
          businessPhoneId: businessId,
        })
      }
    }
  }
  return result
}

async function sendAndLog(conversationId: string, to: string, text: string) {
  const result = await sendWhatsAppText(to, text)
  const externalId = result?.messages?.[0]?.id || null
  await logMessage({
    conversationId,
    direction: 'outbound',
    role: 'assistant',
    content: text,
    externalMessageId: externalId,
  })
}

/** Inventario real usado para calcular precio y PDF; sin valores decorativos. */
async function inventoryReviewQuestion(state: QuoteSessionRow['state']): Promise<string> {
  const ids = state.items.map((item) => item.catalogItemId)
  const names = new Map<string, string>()
  if (ids.length) {
    const { data, error } = await supabaseAdmin.from('catalog_items').select('id,name').in('id', ids)
    if (error) throw new Error(error.message)
    for (const row of (data || []) as Array<{id: string | number; name: string}>) names.set(String(row.id), String(row.name))
  }
  const list = state.items.map((item) => `• ${item.quantity} × ${names.get(item.catalogItemId) || 'Artículo pendiente de identificar'}`).join('\n')
  return inventoryMessage(list)
}

async function nextQuestion(state: QuoteSessionRow['state']): Promise<string> {
  const section = getNextSection(state)
  return section === 7 ? inventoryReviewQuestion(state) : sectionQuestion(section, state)
}

/** Aplica ediciones compuestas en una sola actualización atómica de quote_sessions.state. */
async function editInventory(sessionId: string, text: string): Promise<{
  updated: QuoteSessionRow | null; response: string
}> {
  const edits = parseInventoryEdits(text)
  if (!edits) return { updated: null, response: 'No reconocí el comando.' }
  const { data, error } = await supabaseAdmin.from('catalog_items').select('id,name,is_active')
  if (error) throw new Error(error.message)
  const catalog: CatalogInventoryItem[] = (data || []).map((row: any) => ({
    id: String(row.id), name: String(row.name), is_active: row.is_active !== false,
  }))
  // Revalidar TODOS los cambios en cada reintento CAS. No se guarda nada si
  // QUITAR o AGREGAR falla, incluso con mensajes concurrentes.
  let details: string[] = []
  try {
    const updated = await mutateQuoteSessionAtomically(sessionId, (state) => {
      const result = applyInventoryEdits(state.items, edits, catalog)
      if (!result.ok) throw new Error(result.error)
      details = result.descriptions
      return { ...state, items: result.items, confirmed: false }
    })
    return { updated, response: `Cambios guardados:\n${details.join('\n')}\n\n${await inventoryReviewQuestion(updated.state)}` }
  } catch (error) {
    if (error instanceof Error && /No cambié nada|inventario quedaría vacío|No pude interpretar/.test(error.message)) {
      return { updated: null, response: error.message }
    }
    throw error
  }
}

async function handleHumanHandoff(_session: QuoteSessionRow, conversationId: string, to: string) {
  // Derivación dormida: no se cambia bot_state, estado de cotización ni DB.
  await sendAndLog(conversationId, to, 'La derivación a secretaría todavía no está habilitada. Puedes seguir cotizando aquí.')
}

async function finalizeQuote(session: QuoteSessionRow, conversationId: string, to: string) {
  // Cargar la versión final: las fotos pudieron haberse procesado en paralelo.
  const { data: fresh, error: freshError } = await supabaseAdmin
    .from('quote_sessions').select('*').eq('id', session.id).maybeSingle()
  if (freshError || !fresh) throw new Error(freshError?.message || 'Sesión no encontrada')
  session = fresh as QuoteSessionRow
  if (getNextSection(session.state) !== 7 || !canCloseInventory(session.state)
    || (session.state.inventoryPhotos?.length && !session.state.inventoryCollectionDone)) {
    await sendAndLog(conversationId, to, 'Todavía no tengo un inventario validado. Revisemos primero los muebles para evitar una cotización incorrecta.')
    return
  }
  await sendAndLog(conversationId, to, 'Perfecto. Estoy generando tu cotización y el PDF con el detalle. Dame unos segundos…')
  const quote = await generateQuoteFromSession(session)
  // La cotización ya existe; cerrar autorización de OpenAI ANTES de enviar el PDF.
  await setBotMode(normalizePhone(to), 'idle')
  await logAction({
    conversationId,
    action: 'quote_generated',
    payload: {
      quoteId: quote.quoteId,
      estimatedPrice: quote.estimatedPrice,
      totalVolume: quote.totalVolume,
      totalDistance: quote.totalDistance,
      pdfUrl: quote.pdfUrl,
    },
  })
  await updateConversation(conversationId, {
    status: 'quoted',
    converted: true,
    quote_id: quote.quoteId,
    customer_name: session.state.personalInfo.name,
  })

  const site = (process.env.WHATSAPP_QUOTE_BASE_URL
    || process.env.NEXT_PUBLIC_APP_URL
    || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '')
    || 'https://yo-me-encargo-test97.vercel.app').replace(/\/$/, '')
  const resumeUrl = `${site}/cotizador?session=${encodeURIComponent(session.id)}&token=${encodeURIComponent(session.resume_token)}`

  const summary = [
    '✅ *Tu cotización estimativa está lista*',
    `Cotización: ${quote.quoteId}`,
    `Volumen estimado: ${quote.totalVolume.toFixed(2)} m³`,
    `Distancia estimada: ${quote.totalDistance.toFixed(1)} km`,
    `Valor estimado: $${quote.estimatedPrice.toLocaleString('es-CL')}`,
    'Este valor está sujeto a revisión humana y puede ajustarse antes de confirmar el trabajo.',
    '',
    `Puedes revisar los datos también en la web: ${resumeUrl}`,
    '',
    '¿Quieres afinar los detalles con una persona? Escribe *ASESOR* y seguimos contigo por este mismo chat.',
  ].join('\n')

  await sendAndLog(conversationId, to, summary)
  await sendWhatsAppDocument(to, quote.pdfUrl, quote.pdfFileName, 'Cotización Yo Me Encargo')
  await logMessage({
    conversationId,
    direction: 'outbound',
    role: 'assistant',
    content: quote.pdfUrl,
    messageType: 'document',
    metadata: { quoteId: quote.quoteId, filename: quote.pdfFileName },
  })
}

/** Muestra el documento de campos interpretados, con nombres copiables para corregir. */
async function sendFreeformReview(session: QuoteSessionRow, conversationId: string, to: string, intro = '', mode: 'full' | 'next' = 'full') {
  if (mode === 'next') {
    const reply = session.state.intake?.tommyVersion === 1
      ? (tommyPendingMessage(session.state) || 'Tu solicitud ya está registrada para revisión. 🚚')
      : formatIntakeNextPrompt(session.state)
    await sendAndLog(conversationId, to, intro ? `${intro}\n\n${reply}` : reply)
    return
  }
  const ids = session.state.items.map((item) => item.catalogItemId)
  const names = new Map<string, string>()
  if (ids.length) {
    const { data, error } = await supabaseAdmin.from('catalog_items').select('id,name').in('id', ids)
    if (error) throw new Error(error.message)
    for (const row of (data || []) as Array<{id: string | number; name: string}>) names.set(String(row.id), String(row.name))
  }
  const itemNames = session.state.items.map((item) => `${item.quantity} × ${names.get(item.catalogItemId) || 'ARTÍCULO SIN NOMBRE'}`)
  const summary = formatIntakeReview(session.state, itemNames)
  await sendAndLog(conversationId, to, intro ? `${intro}\n\n${summary}` : summary)
}

/** Comprueba horarios incluso si FECHA/HORA llegaron dentro de un mensaje largo. */
async function validateFreeformSchedule(state: QuoteSessionRow['state']): Promise<string> {
  if (!state.schedule.date || !state.schedule.time) return ''
  try {
    const slots = await getAvailableSlotsForDate(state.schedule.date)
    if (!slots.some((slot) => slot.time === state.schedule.time)) {
      const requested = state.schedule.time
      state.schedule.time = null
      return `El horario ${requested} no está disponible en ${state.schedule.date}. ` +
        (slots.length ? `Opciones: ${slots.slice(0, 8).map((slot) => slot.time).join(', ')}.` : 'Indica otra fecha.')
    }
  } catch (error) {
    // El cotizador tradicional continúa si la disponibilidad no está accesible.
    console.warn('[WhatsApp][ficha] No fue posible consultar disponibilidad:', error)
  }
  return ''
}

/** Al completar los seis grupos: precio y PDF, sin dependencia de secretaría. */
async function finishTommyQuote(session: QuoteSessionRow, conversationId: string, to: string) {
  const missing = session.state.intake?.quoteFlowVersion === 2 ? missingQuoteQuestions(session.state) : rawQuoteGaps(session.state)
  if (missing.length) {
    await sendAndLog(conversationId, to, session.state.intake?.quoteFlowVersion === 2 ? (missingQuoteMessage(session.state) || '') : nextShortQuestion(session.state))
    return
  }
  // No recalcular al recibir una confirmación duplicada; reenviar el enlace existente.
  if (session.pdf_url && session.quote_id && session.status === 'quoted') {
    await sendAndLog(conversationId, to,
      `Tu cotización estimativa ${session.quote_id} ya está lista: ${session.pdf_url}`)
    return
  }
  let quote: Awaited<ReturnType<typeof generatePreliminaryWhatsAppQuote>>
  try {
    quote = await generatePreliminaryWhatsAppQuote(session)
  } catch (error) {
    // NO desactivar el bot ni pedir nuevamente los seis datos. Se puede reintentar.
    console.error('[WhatsApp][cotización] Falló la generación del precio o PDF:', error)
    await sendAndLog(conversationId, to,
      'Ya tengo tus datos. Hubo un problema técnico al generar el PDF, no con tus respuestas. Escribe *CONFIRMAR* para reintentarlo sin repetir nada.')
    return
  }
  // Entregar precio y enlace ANTES de operaciones administrativas auxiliares.
  await sendAndLog(conversationId, to, [
    `✅ *Cotización estimativa ${quote.quoteId}*`,
    `Volumen: ${quote.totalVolume.toFixed(2)} m³`,
    `Distancia: ${quote.totalDistance.toFixed(1)} km`,
    `*Precio estimado: $${quote.estimatedPrice.toLocaleString('es-CL')}*`,
    'Sujeto a revisión antes de confirmar el servicio.',
    `PDF: ${quote.pdfUrl}`,
  ].join('\n'))
  try {
    await sendWhatsAppDocument(to, quote.pdfUrl, quote.pdfFileName, 'Cotización estimativa Yo Me Encargo')
    await logMessage({ conversationId, direction: 'outbound', role: 'assistant',
      content: quote.pdfUrl, messageType: 'document',
      metadata: { quoteId: quote.quoteId, filename: quote.pdfFileName } })
  } catch (error) {
    // El enlace ya fue enviado; no fingir que falló toda la cotización.
    console.error('[WhatsApp][cotización] PDF guardado, pero Meta no recibió el adjunto:', error)
  }
  try {
    await setBotMode(normalizePhone(to), 'idle')
    await updateConversation(conversationId, { status: 'quoted', converted: true, quote_id: quote.quoteId })
    await logAction({ conversationId, action: 'quote_generated', payload: {
      quoteId: quote.quoteId, estimatedPrice: quote.estimatedPrice, pdfUrl: quote.pdfUrl,
    } })
  } catch (error) {
    // El PDF ya se entregó: un error de telemetría NO anula la cotización.
    console.error('[WhatsApp][cotización] PDF entregado, falló el estado administrativo:', error)
  }
}

/** Flujo de cuatro mensajes aprobado: preguntas -> faltantes (si los hay) -> fotos -> inventario. */
const INITIAL_QUESTIONS = [
  'Nombre, Email y Rut. Si eres empresa escribe boleta o factura y razón social.',
  '¿De qué calle hasta qué calle es el traslado? Incluye número, comuna y región.',
  'Lista de artículos a trasladar.',
  'Fecha y hora del flete. Incluye un SI o NO si puedes cambiar la fecha.',
  '¿Hay ascensor o escalera y en qué piso? Si es casa indícalo.',
  '¿A qué distancia están las entradas del estacionamiento en el origen y destino respectivamente?',
  '¿Necesitas que embalemos algo? Nombra qué artículos.',
  '¿Necesitas que desarmemos y armemos muebles? Nómbralos.',
]

async function finishApprovedQuote(session: QuoteSessionRow, conversationId: string, to: string) {
  const pending = missingQuoteMessage(session.state)
  if (pending) {
    const updated = await mutateQuoteSessionAtomically(session.id, current => withQuoteFlowStep(current, 'questions'))
    await sendAndLog(conversationId, to, missingQuoteMessage(updated.state) || pending)
    return
  }
  if (!canCloseInventory(session.state) ||
    (session.state.inventoryPhotos || []).some(photo => photo.status !== 'done')) {
    await sendAndLog(conversationId, to, 'Todavía hay artículos o fotos por identificar. Indícame cuáles son antes de confirmar. 📦')
    return
  }
  // La comprobación del paso impide emitir PDF antes de mostrar el inventario.
  if (quoteFlowStep(session.state) !== 'inventory') {
    await sendAndLog(conversationId, to, await inventoryReviewQuestion(session.state))
    return
  }
  await finishTommyQuote(session, conversationId, to)
}

async function processApprovedPhoto(
  session: QuoteSessionRow, conversationId: string, to: string,
  message: ReturnType<typeof extractMessages>[number],
) {
  // Registrar la foto antes de la llamada a IA; mismo JSONB, sin migración.
  session = await mutateQuoteSessionAtomically(session.id, current => upsertInventoryPhoto(current, {
    messageId: message.id, status: 'processing', recognized: [],
  }))
  const imageDataUrl = message.imageId ? await downloadWhatsAppMediaAsDataUrl(message.imageId) : null
  if (!imageDataUrl) {
    await mutateQuoteSessionAtomically(session.id, current => upsertInventoryPhoto(current, {
      messageId: message.id, status: 'needs_description', recognized: [],
    }))
    await sendAndLog(conversationId, to, 'No pude abrir esa foto. Reenvíala o descríbeme sus artículos.')
    return
  }
  let stored: Awaited<ReturnType<typeof saveQuotePhoto>>
  try {
    stored = await saveQuotePhoto(session.id, message.id, imageDataUrl)
  } catch (error) {
    console.error('[WhatsApp][fotos] No se pudo guardar original:', error)
    await mutateQuoteSessionAtomically(session.id, current => ({
      ...current, inventoryPhotos: (current.inventoryPhotos || []).filter(photo => photo.messageId !== message.id),
    }))
    await sendAndLog(conversationId, to, 'No pude guardar la foto. Por favor, reenvíala.')
    return
  }
  let inventory: Awaited<ReturnType<typeof parseWhatsAppInventory>>
  try {
    inventory = await parseWhatsAppInventory(message.text, imageDataUrl)
  } catch (error) {
    console.error('[WhatsApp][fotos] Falló el reconocimiento:', error)
    await mutateQuoteSessionAtomically(session.id, current => upsertInventoryPhoto(current, {
      messageId: message.id, status: 'needs_description', recognized: [], storagePath: stored.storagePath,
    }))
    await sendAndLog(conversationId, to, 'No pude identificar los artículos de la foto. Escríbeme qué aparece.')
    return
  }
  await addUsage(conversationId, inventory.usage).catch(console.warn)
  session = await mutateQuoteSessionAtomically(session.id, current => {
    const next = upsertInventoryPhoto(mergeInventory(current, inventory.statePatch), {
      messageId: message.id,
      status: inventory.needsReview ? 'needs_description' : 'done',
      recognized: inventory.recognizedNames, storagePath: stored.storagePath,
    })
    next.additionalServices.photos = [...new Set([...(next.additionalServices.photos || []), stored.publicUrl])]
    return next
  })
  if (inventory.needsReview) {
    await sendAndLog(conversationId, to, 'Recibí la foto, pero hay artículos que no pude reconocer. ¿Cuáles son?')
  } else if (quoteFlowStep(session.state) === 'questions') {
    await sendAndLog(conversationId, to, missingQuoteMessage(session.state) || QUOTE_FIRST_MESSAGE)
  } else if (quoteFlowStep(session.state) === 'inventory') {
    await sendAndLog(conversationId, to, await inventoryReviewQuestion(session.state))
  } else {
    await sendAndLog(conversationId, to, 'Foto añadida al inventario 📸 Puedes enviar más o escribir *LISTO* para revisarlo.')
  }
}

async function processApprovedQuoteTurn(
  session: QuoteSessionRow, conversationId: string, to: string,
  message: ReturnType<typeof extractMessages>[number],
) {
  const step = quoteFlowStep(session.state)
  const text = message.text.trim()
  if (message.type === 'image') {
    if (step === 'questions') {
      await sendAndLog(conversationId, to, 'Primero terminemos los datos del traslado. Luego te pediré las fotos opcionales. 📸\n\n' + (missingQuoteMessage(session.state) || QUOTE_FIRST_MESSAGE))
      return
    }
    await processApprovedPhoto(session, conversationId, to, message)
    return
  }
  if (step === 'questions') {
    if (/^(s[ií]|no)[.!\s]*$/i.test(text) && missingQuoteQuestions(session.state).length > 1) {
      await sendAndLog(conversationId, to, missingQuoteMessage(session.state) || QUOTE_FIRST_MESSAGE)
      return
    }
    if (isInventoryConfirm(text)) {
      await sendAndLog(conversationId, to, missingQuoteMessage(session.state) || QUOTE_FIRST_MESSAGE)
      return
    }
    const normalized = normalizeQuoteCustomerReply(text)
    if (!normalized) {
      await sendAndLog(conversationId, to, missingQuoteMessage(session.state) || QUOTE_FIRST_MESSAGE)
      return
    }
    const count = session.state.intake?.nlpQuestionCount || 1
    const questions = count <= 1 ? INITIAL_QUESTIONS : missingQuoteQuestions(session.state)
    let parsed: Awaited<ReturnType<typeof parseRawCustomerQuote>>
    try {
      parsed = await parseRawCustomerQuote(session.state, normalized, questions)
    } catch (error) {
      console.error('[WhatsApp][NLP] No se pudo interpretar el mensaje:', error)
      await sendAndLog(conversationId, to, 'No pude procesar el último mensaje. Tus respuestas anteriores están guardadas; reenvía solo este mensaje.')
      return
    }
    session = await mutateQuoteSessionAtomically(session.id, current => {
      const merged = mergeRawQuote(current, parsed.data)
      merged.intake!.nlpLastRaw = text
      merged.intake!.nlpQuestionCount = count + 1
      return merged
    })
    await addUsage(conversationId, parsed.usage).catch(console.warn)
    const pending = missingQuoteMessage(session.state)
    if (pending) {
      await sendAndLog(conversationId, to, pending)
    } else {
      session = await mutateQuoteSessionAtomically(session.id, current => withQuoteFlowStep(current, 'photos'))
      await sendAndLog(conversationId, to, QUOTE_PHOTO_MESSAGE)
    }
    return
  }
  if (step === 'photos') {
    if (isPhotoFinish(text)) {
      if (!canCloseInventory(session.state)) {
        const unresolved = session.state.inventoryPhotos?.filter(p => p.status !== 'done') || []
        await sendAndLog(conversationId, to, unresolved.length
          ? 'Quedan fotos sin identificar. Escríbeme qué aparece en ellas para incorporarlas.'
          : 'Aún falta el inventario. Escribe los artículos que trasladaremos y sus cantidades.')
        return
      }
      session = await mutateQuoteSessionAtomically(session.id, current => {
        const next = withQuoteFlowStep(current, 'inventory')
        next.inventoryCollectionDone = true
        return next
      })
      await sendAndLog(conversationId, to, await inventoryReviewQuestion(session.state))
      return
    }
    if (!text) {
      await sendAndLog(conversationId, to, QUOTE_PHOTO_MESSAGE)
      return
    }
    // Si una foto no se pudo interpretar, la descripción del cliente la resuelve.
    const inventory = await parseWhatsAppInventory(text)
    await addUsage(conversationId, inventory.usage).catch(console.warn)
    session = await mutateQuoteSessionAtomically(session.id, current => {
      const next = mergeInventory(current, inventory.statePatch)
      const photo = (next.inventoryPhotos || []).find(p => p.status === 'needs_description')
      if (photo && !inventory.needsReview && inventory.statePatch.items.length) {
        return upsertInventoryPhoto(next, { ...photo, status: 'done', recognized: inventory.recognizedNames })
      }
      return next
    })
    await sendAndLog(conversationId, to, inventory.needsReview
      ? 'Hay artículos sin identificar. Descríbelos mejor, por favor.'
      : 'Artículos registrados 📦 Puedes enviar fotos, o escribir *LISTO* para revisar el inventario.')
    return
  }
  // Última etapa: la revisión siempre ocurre ANTES del PDF.
  if (isInventoryConfirm(text)) {
    await finishApprovedQuote(session, conversationId, to)
    return
  }
  if (/^(inventario|ver inventario|revisar)[.!\s]*$/i.test(text)) {
    await sendAndLog(conversationId, to, await inventoryReviewQuestion(session.state))
    return
  }
  if (parseInventoryEdits(text) !== null) {
    const result = await editInventory(session.id, text)
    await sendAndLog(conversationId, to, result.response)
    return
  }
  await sendAndLog(conversationId, to, 'Para modificar tu inventario escribe *Quitar:* o *Agregar:* con los artículos. Para recibir el PDF escribe *confirmar*.')
}

/** Flujo simple de Tommy: WhatsApp crudo -> OpenAI (UNA llamada) -> estado persistente -> PDF.
 * Los parsers antiguos quedan fuera de esta ruta; no imponemos formularios ni un segundo análisis.
 */
async function processTommyQuoteTurn(
  session: QuoteSessionRow, conversationId: string, to: string,
  message: ReturnType<typeof extractMessages>[number],
) {
  const text = message.text.trim()
  if (!text) {
    await sendAndLog(conversationId, to, 'Envíame tu solicitud de mudanza por escrito, con los datos que conozcas. 😊')
    return
  }
  if (/^(confirmar|confirmo|pdf)[.!\s]*$/i.test(text)) {
    await finishTommyQuote(session, conversationId, to)
    return
  }
  if (/^(ficha|resumen)[.!\s]*$/i.test(text)) {
    await sendFreeformReview(session, conversationId, to)
    return
  }
  let parsed
  try {
    parsed = await parseRawCustomerQuote(session.state, text)
  } catch (error) {
    console.error('[WhatsApp][NLP] Falló la llamada OpenAI, no el español del cliente:', error)
    // No inventar que se entendió, no borrar el progreso ni repetir los mismos datos.
    await sendAndLog(conversationId, to, 'Hubo un problema técnico al procesar tu mensaje. Tus datos anteriores siguen guardados; puedes reenviar solo este último mensaje.')
    return
  }
  // Consolidar contra la versión MÁS RECIENTE; un segundo mensaje o foto no debe
  // sobrescribir respuestas que llegaron en paralelo desde otro webhook.
  session = await mutateQuoteSessionAtomically(session.id, current => {
    const merged = mergeRawQuote(current, parsed.data)
    merged.intake!.nlpLastRaw = text
    return merged
  })
  await addUsage(conversationId, parsed.usage).catch(error => console.warn('[WhatsApp][NLP] Telemetría:', error))
  const gaps = rawQuoteGaps(session.state)
  console.info('[WhatsApp][NLP] Campos pendientes:', gaps, 'quote_session:', session.id)
  if (!gaps.length) {
    await finishTommyQuote(session, conversationId, to)
    return
  }
  // Una sola repregunta conjunta; si el cliente deja algo sin responder se vuelve
  // a pedir ÚNICAMENTE lo pendiente, sin tope artificial ni interrogatorio secuencial.
  await sendAndLog(conversationId, to, nextShortQuestion(session.state))
}

/** El cliente puede responder en un párrafo, un bloque de variables o una fotografía. */
async function processFreeformQuoteTurn(
  session: QuoteSessionRow,
  conversationId: string,
  to: string,
  message: ReturnType<typeof extractMessages>[number],
) {
  const text = message.text.trim()
  if (message.type === 'image') {
    session = await mutateQuoteSessionAtomically(session.id, (current) => upsertInventoryPhoto(current, {
      messageId: message.id, status: 'processing', recognized: [],
    }))
    const imageDataUrl = message.imageId ? await downloadWhatsAppMediaAsDataUrl(message.imageId) : null
    if (!imageDataUrl) {
      await mutateQuoteSessionAtomically(session.id, (current) => upsertInventoryPhoto(current, {
        messageId: message.id, status: 'needs_description', recognized: [],
      }))
      await sendAndLog(conversationId, to, 'No pude abrir la foto. Escríbeme qué muebles contiene y los agregaré a la ficha.')
      return
    }
    let photoStorage: Awaited<ReturnType<typeof saveQuotePhoto>>
    try {
      photoStorage = await saveQuotePhoto(session.id, message.id, imageDataUrl)
    } catch (error) {
      console.error('[WhatsApp][ficha] Error conservando fotografía:', error)
      await mutateQuoteSessionAtomically(session.id, (current) => ({
        ...current, inventoryPhotos: (current.inventoryPhotos || []).filter((photo) => photo.messageId !== message.id),
      }))
      await sendAndLog(conversationId, to, 'No pude guardar la foto. Por favor, reenvíala.')
      return
    }
    let inventory: Awaited<ReturnType<typeof parseWhatsAppInventory>>
    try {
      inventory = await parseWhatsAppInventory(text, imageDataUrl)
    } catch (error) {
      console.error('[WhatsApp][ficha] Error analizando fotografía:', error)
      await mutateQuoteSessionAtomically(session.id, (current) => upsertInventoryPhoto(current, {
        messageId: message.id, status: 'needs_description', recognized: [], storagePath: photoStorage.storagePath,
      }))
      await sendAndLog(conversationId, to, 'No pude reconocer el contenido. Escribe los muebles de la foto y los incorporaré.')
      return
    }
    await addUsage(conversationId, inventory.usage)
    session = await mutateQuoteSessionAtomically(session.id, (current) => {
      let next = mergeInventory(current, inventory.statePatch)
      next = upsertInventoryPhoto(next, {
        messageId: message.id, status: inventory.needsReview ? 'needs_description' : 'done',
        recognized: inventory.recognizedNames, storagePath: photoStorage.storagePath,
      })
      next.additionalServices.photos = [...new Set([...(next.additionalServices.photos || []), photoStorage.publicUrl])]
      next.inventoryCollectionDone = true
      if (next.intake) next.intake.stage = 'review'
      return next
    })
    await sendFreeformReview(session, conversationId, to, inventory.needsReview
      ? 'La foto requiere que describas los objetos que no pude reconocer.' : '✓ Foto incorporada al inventario.', 'next')
    return
  }

  if (CONFIRM_QUOTE.test(text)) {
    if (session.state.intake?.stage === 'review' && intakeCanConfirm(session.state) && getNextSection(session.state) === 7) {
      await finalizeQuote(session, conversationId, to)
    } else {
      await sendFreeformReview(session, conversationId, to, 'Todavía faltan algunos datos para cotizar.', 'next')
    }
    return
  }

  if (!text || (isGreeting(text) && session.state.intake?.stage === 'describe')) {
    await sendAndLog(conversationId, to, FREEFORM_START)
    return
  }

  if (/^(ficha|resumen|ver ficha)[.!\s]*$/i.test(text)) {
    await sendFreeformReview(session, conversationId, to)
    return
  }

  // Una respuesta SÍ/NO aislada no autoriza inferir a cuál de seis preguntas
  // corresponde. Repetir el bloque completo en lugar de pasarla al modelo.
  if (nextIntakePending(session.state)?.label === 'CONFIRMACIONES'
    && /^(s[ií]|no)[.!\s]*$/i.test(text)) {
    await sendAndLog(conversationId, to, formatIntakeNextPrompt(session.state))
    return
  }

  // La pregunta activa identifica las respuestas cortas sin etiquetas. Los relatos
  // largos y correcciones múltiples siguen pasando por el parser estructurado.
  const focusedEdit = inferSinglePendingEdit(session.state, text)
  const ambiguity = focusedEdit ? null : ambiguousGroupedReply(session.state, text)
  if (ambiguity) {
    await sendAndLog(conversationId, to, ambiguity)
    return
  }
  const editingText = focusedEdit || text

  // Las variables etiquetadas se aplican determinísticamente (sin adivinar campos).
  const labels = applyLabelEdits(session.state, editingText)
  if (labels.recognized && !isContractClauseReply(text)) {
    if (labels.errors.length) {
      await sendAndLog(conversationId, to, `No cambié la ficha porque encontré lo siguiente:\n• ${labels.errors.join('\n• ')}\n\nCorrige estas líneas y reenvíalas.`)
      return
    }
    let newState = labels.state
    if (labels.inventory) {
      const parsedInventory = await parseWhatsAppInventory(labels.inventory.description)
      await addUsage(conversationId, parsedInventory.usage)
      if (!parsedInventory.statePatch.items.length || parsedInventory.statePatch.pendingInventory.length) {
        await sendAndLog(conversationId, to, 'No cambié el inventario: hay objetos sin identificar. Descríbelos con su cantidad y tipo.')
        return
      }
      newState = labels.inventory.mode === 'replace'
        ? { ...newState, items: parsedInventory.statePatch.items, pendingInventory: [], inventoryCollectionDone: true }
        : mergeInventory(newState, parsedInventory.statePatch)
    }
    newState.confirmed = false
    if (newState.intake) newState.intake.stage = 'review'
    const availability = await validateFreeformSchedule(newState)
    session = await saveQuoteSession(session.id, newState)
    await logAction({ conversationId, action: 'intake_variables_edited', payload: { changed: labels.changed, messageId: message.id } })
    await sendFreeformReview(session, conversationId, to, availability, 'next')
    return
  }

  // El inventario se puede corregir con QUITAR/AGREGAR, sin afectar otros campos.
  if (parseInventoryEdits(text) !== null && session.state.intake?.stage === 'review') {
    const edit = await editInventory(session.id, text)
    if (edit.updated) await sendFreeformReview(edit.updated, conversationId, to, '', 'next')
    else await sendAndLog(conversationId, to, edit.response)
    return
  }

  // Una descripción natural puede contener datos de las siete secciones.
  const parsed = await parseGeneralWhatsAppTurn(0, session.state, text)
  await addUsage(conversationId, parsed.usage)
  let nextState = parsed.state
  const doc = parseTaxDocumentChoice(text)
  if (doc) {
    nextState.taxDocument = doc
    nextState.personalInfo.isCompany = doc === 'factura'
  }
  const patch = parsed.patch
  let knownServices = INTAKE_SERVICES.filter((key) => patch[key] !== null)
  if (/\b(ningun(os)? servicio(s)?|sin servicios (adicionales)?|no necesito (servicios|embalaje ni desarmado))\b/i.test(text.normalize('NFD').replace(/[\u0300-\u036f]/g, ''))) {
    for (const key of INTAKE_SERVICES) nextState.additionalServices[key] = false
    knownServices = INTAKE_SERVICES
  }
  nextState = markServiceAnswers(nextState, knownServices)
  if (patch.inventoryDescription?.trim()) {
    const inventory = await parseWhatsAppInventory(patch.inventoryDescription)
    await addUsage(conversationId, inventory.usage)
    if (inventory.statePatch.items.length || inventory.statePatch.pendingInventory.length) {
      nextState = mergeInventory(nextState, inventory.statePatch)
      nextState.inventoryCollectionDone = true
    }
  }
  nextState.confirmed = false // Solo CONFIRMAR exacto autoriza el precio/PDF.
  if (nextState.intake) nextState.intake.stage = 'review'
  const availability = await validateFreeformSchedule(nextState)
  session = await saveQuoteSession(session.id, nextState)
  await logAction({ conversationId, action: 'intake_freeform_parsed', payload: {
    messageId: message.id, summary: patch.normalizedSummary,
    fieldsRecognized: Object.entries(patch).filter(([key, value]) => value !== null && !['normalizedSummary', 'explicitConfirmation'].includes(key)).map(([key]) => key),
  } })
  await sendFreeformReview(session, conversationId, to, availability, 'next')
}

async function deactivateBot(phone: string, bot: WhatsAppBotState) {
  if (bot.quote_session_id && bot.mode === 'quoting') {
    await closeQuoteSession(bot.quote_session_id)
    const { error } = await supabaseAdmin.from('ai_conversations')
      .update({ status: 'closed', updated_at: new Date().toISOString() })
      .eq('quote_session_id', bot.quote_session_id).eq('channel', 'whatsapp').eq('status', 'active')
    if (error) throw new Error(error.message)
  }
  await setBotMode(phone, 'idle')
}

export async function processIncoming(message: ReturnType<typeof extractMessages>[number]) {
  // Interruptor de emergencia de Vercel. Nunca llama a OpenAI con el bot apagado.
  if (process.env.WHATSAPP_BOT_ENABLED === 'false') {
    console.warn(messageContext.getStore()?.platform === 'instagram'
      ? '[Instagram][motor] Bot deshabilitado por WHATSAPP_BOT_ENABLED=false'
      : '[WhatsApp][motor] Bot deshabilitado por WHATSAPP_BOT_ENABLED=false')
    return
  }
  const to = message.from
  const phone = normalizePhone(to)
  if (!(await claimIncomingMessage({
    phone,
    messageId: message.id,
    content: message.text || (message.type === 'image' ? '[Imagen]' : `[${message.type}]`),
    messageType: message.type === 'image' ? 'image' : message.type === 'interactive' ? 'interactive' : 'text',
  }))) {
    console.info(messageContext.getStore()?.platform === 'instagram'
      ? '[Instagram][motor] Mensaje duplicado; se omite el reenvío'
      : '[WhatsApp][motor] Mensaje duplicado; se omite el reenvío')
    return
  }

  const bot = await ensureBotState(phone)
  const decision = decideBotAction(message.text, bot)
  console.info(messageContext.getStore()?.platform === 'instagram'
    ? '[Instagram][motor] Decisión' : '[WhatsApp][motor] Decisión', JSON.stringify({
    decision, mode: bot.mode, greeted: Boolean(bot.greeted_at),
  }))

  if (decision === 'welcome') {
    // No se crea quote_session ni se usa OpenAI por un saludo o texto cualquiera.
    const claimAt = await claimFirstWelcome(phone, bot.mode === 'idle' && isGreeting(message.text))
    if (!claimAt) return
    try {
      await sendWhatsAppText(to, WHATSAPP_WELCOME)
    } catch (error) {
      await releaseFailedWelcome(phone, claimAt)
      throw error
    }
    return
  }

  if (decision === 'start_quote' || decision === 'start_new_quote') {
    if (decision === 'start_new_quote') {
      // Solo NUEVA cierra deliberadamente una cotización anterior; COTIZAR/RETOMAR la conserva.
      if (bot.mode === 'quoting') await deactivateBot(phone, bot)
      const { error } = await supabaseAdmin.from('quote_sessions')
        .update({ status: 'closed', updated_at: new Date().toISOString() })
        .eq('channel', 'whatsapp').eq('phone', phone).in('status', ['collecting', 'ready'])
      if (error) throw new Error(error.message)
    }
    let session = decision === 'start_new_quote'
      ? await createWhatsAppSession(phone, customerPhone(to))
      : await getOrCreateWhatsAppSession(phone)
    // Después de generar un PDF, COTIZAR inicia otra cotización.
    // RETOMAR conserva la cotización si todavía estaba en recopilación.
    if (botCommand(message.text) === 'COTIZAR' && session.state.intake?.tommySubmittedAt) {
      const { error: archiveError } = await supabaseAdmin.from('quote_sessions')
        .update({ status: 'closed', updated_at: new Date().toISOString() })
        .eq('id', session.id).in('status', ['collecting', 'ready'])
      if (archiveError) throw new Error(archiveError.message)
      session = await createWhatsAppSession(phone, customerPhone(to))
    }
    if (session.state.intake && !session.state.intake.quoteFlowVersion &&
      (botCommand(message.text) === 'COTIZAR' || botCommand(message.text) === 'RETOMAR')) {
      // Reanudar conversaciones anteriores con el nuevo flujo, conservando su JSONB.
      session = await mutateQuoteSessionAtomically(session.id, current => {
        const pending = missingQuoteQuestions(current)
        const hasFinishedPhotos = Boolean(current.inventoryPhotos?.length && current.inventoryCollectionDone)
        const nextStep = pending.length ? 'questions' : hasFinishedPhotos ? 'inventory' : 'photos'
        const upgraded = withQuoteFlowStep(current, nextStep)
        upgraded.intake!.nlpQuestionCount = Math.max(2, upgraded.intake!.nlpQuestionCount || 0)
        return upgraded
      })
    }
    if (messageContext.getStore()?.platform === 'instagram' && session.state.intake) {
      session = await saveQuoteSession(session.id, { ...session.state, intake: undefined })
    }
    await setBotMode(phone, 'quoting', session.id)
    const conversation = await findOrCreateWhatsAppConversation(phone, session.id, message.profileName)
    const conversationId = conversation.id as string
    await moveIncomingToConversation(message.id, conversationId)
    const resumed = Date.now() - Date.parse(session.created_at) > 10_000
    if (session.state.intake?.quoteFlowVersion === 2) {
      if (!botCommand(message.text) && message.text.trim()) {
        await processApprovedQuoteTurn(session, conversationId, to, message)
        return
      }
      const step = quoteFlowStep(session.state)
      if (step === 'questions') {
        if (!resumed) {
          session = await mutateQuoteSessionAtomically(session.id, current => {
            current.intake!.nlpQuestionCount ||= 1
            return current
          })
          await sendAndLog(conversationId, to, QUOTE_FIRST_MESSAGE)
        } else {
          await sendAndLog(conversationId, to, missingQuoteMessage(session.state) || QUOTE_FIRST_MESSAGE)
        }
      } else if (step === 'photos') {
        await sendAndLog(conversationId, to, QUOTE_PHOTO_MESSAGE)
      } else {
        await sendAndLog(conversationId, to, await inventoryReviewQuestion(session.state))
      }
      return
    }
    if (session.state.intake?.tommyVersion === 1) {
      // El cliente respondió al menú directamente en español natural: procesar YA.
      // Evita la pantalla extra que antes descartaba ese primer mensaje.
      if (!botCommand(message.text) && message.text.trim()) {
        await processTommyQuoteTurn(session, conversationId, to, message)
        return
      }
      if (!resumed && (session.state.intake.nlpQuestionCount || 0) === 0) {
        session = await saveQuoteSession(session.id, {
          ...session.state, intake: { ...session.state.intake, nlpQuestionCount: 1 },
        })
      }
      const prompt = resumed
        ? (rawQuoteGaps(session.state).length ? nextShortQuestion(session.state) : 'Ya tenemos todo. Escribe CONFIRMAR si quieres recibir nuevamente el PDF.')
        : QUOTE_INTAKE_QUESTIONS
      await sendAndLog(conversationId, to, prompt)
    } else if (resumed && session.state.intake?.stage === 'review') {
      await sendFreeformReview(session, conversationId, to, 'Retomamos tu cotización donde quedó.', 'next')
    } else {
      await sendAndLog(conversationId, to, resumed
        ? `Retomamos tu cotización.\n${await nextQuestion(session.state)}`
        : session.state.intake ? FREEFORM_START : sectionQuestion(1, session.state))
    }
    return
  }

  if (decision === 'human') {
    // Dormido hasta migración de DB. NO llamar a handoff_requests,
    // NO cambiar bot_state.mode a 'human', NO cerrar la sesión.
    await sendWhatsAppText(to, 'La atención por secretaría todavía no está habilitada. Si estás cotizando, puedes seguir aquí sin perder tus datos.')
    return
  }

  if (decision === 'exit' || decision === 'menu') {
    // MENÚ no destruye la cotización; SALIR es la única salida que la cierra.
    if (decision === 'menu') {
      await setBotMode(phone, 'idle')
      await sendWhatsAppText(to, WHATSAPP_WELCOME)
      return
    }
    await deactivateBot(phone, bot)
    await sendWhatsAppText(to, 'Atención terminada. Para volver, escribe *COTIZAR*.')
    return
  }

  if (decision === 'expire_silent') {
    // Detener autorización de IA, NO borrar la cotización. El cliente puede reanudarla.
    await setBotMode(phone, 'idle')
    await sendWhatsAppText(to, 'Tu cotización sigue guardada. Escribe *RETOMAR* para continuar donde quedaste.')
    return
  }

  if (decision === 'silent') {
    if (bot.mode === 'human') {
      // collectHandoffDetails requiere handoff_requests; no registrar solicitudes falsas.
      await touchIdleActivity(phone)
    }
    if (bot.mode === 'idle') await touchIdleActivity(phone)
    return
  }

  // Solo se llega aquí con una sesión iniciada explícitamente por COTIZAR.
  if (!bot.quote_session_id) {
    await setBotMode(phone, 'idle')
    return
  }
  const { data, error } = await supabaseAdmin
    .from('quote_sessions')
    .select('*')
    .eq('id', bot.quote_session_id)
    .eq('phone', phone)
    .eq('channel', 'whatsapp')
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data || !['collecting', 'ready'].includes(data.status)) {
    await setBotMode(phone, 'idle')
    await sendWhatsAppText(to, 'La cotización anterior ya no está activa. Escribe *COTIZAR* para iniciar otra.')
    return
  }
  let session = data as QuoteSessionRow
  if (!(await refreshQuoteActivity(phone, session.id))) return

  const conversation = await findOrCreateWhatsAppConversation(phone, session.id, message.profileName)
  const conversationId = conversation.id as string
  await moveIncomingToConversation(message.id, conversationId)

  // Notas de voz y otros adjuntos no son texto parseable. Evita llamar
  // a OpenAI con un texto vacío y perder la respuesta silenciosamente.
  if (message.type !== 'text' && message.type !== 'interactive' && message.type !== 'image') {
    await sendAndLog(conversationId, to, 'Por ahora necesito que respondas por escrito. En la etapa de fotos también puedes enviar imágenes.')
    return
  }

  // Conserva la referencia a una cotización originada en la web, sin activación implícita.
  const embeddedQuoteId = extractQuoteIdFromText(message.text)
  if (embeddedQuoteId) {
    await updateConversation(conversationId, { quote_id: embeddedQuoteId })
    session = await saveQuoteSession(session.id, session.state, { quote_id: embeddedQuoteId })
  }

  if (HUMAN_REQUEST.test(message.text) && !/\b(no|sin|ning[uú]n)\b.{0,25}\b(asesor|ejecutivo|humano)\b/i.test(message.text)) {
    await sendAndLog(conversationId, to, 'La derivación a secretaría está temporalmente desactivada. Puedes continuar tu cotización aquí.')
    return
  }

  if (!session.state.intake && isGreeting(message.text) && session.current_section === 1 && !session.state.personalInfo.name) {
    await sendAndLog(conversationId, to, sectionQuestion(1, session.state))
    return
  }

  let state = session.state
  let section = getNextSection(state)

  // Nuevo flujo: declaración libre -> ficha editable -> confirmación explícita.
  // Sesiones antiguas sin state.intake siguen el flujo previo para no romperlas.
  if (state.intake?.quoteFlowVersion === 2) {
    await processApprovedQuoteTurn(session, conversationId, to, message)
    return
  }
  if (state.intake?.tommyVersion === 1) {
    await processTommyQuoteTurn(session, conversationId, to, message)
    return
  }
  if (state.intake) {
    await processFreeformQuoteTurn(session, conversationId, to, message)
    return
  }

  // Respuesta tributaria determinista: una elección no inventa ni cambia el IVA.
  if (section === 1 && state.personalInfo.name && state.personalInfo.email && !state.taxDocument) {
    const choice = parseTaxDocumentChoice(message.text)
    if (choice) {
      state = { ...state, taxDocument: choice,
        personalInfo: { ...state.personalInfo, isCompany: choice === 'factura' ? true : state.personalInfo.isCompany } }
      session = await saveQuoteSession(session.id, state)
      await sendAndLog(conversationId, to, await nextQuestion(state))
    } else {
      await sendAndLog(conversationId, to, sectionQuestion(1, state))
    }
    return
  }


  if (section === 5 && CONFIRM_QUOTE.test(message.text)) {
    await sendAndLog(conversationId, to, 'Aún estamos reuniendo el inventario. Cuando termines de enviar tus muebles, escribe *LISTO*. Te mostraré la lista completa antes de generar el precio.')
    return
  }

  // La lista queda abierta mientras el cliente envía fotografías. Enviar LISTO
  // una sola vez evita que una foto posterior se pierda o adelante los extras.
  if (section === 5 && /^(listo|termine|termin[eé]|eso es todo|nada mas|nada m[aá]s)[.!\s]*$/i.test(message.text)) {
    session = await mutateQuoteSessionAtomically(session.id, (current) => ({
      ...current, inventoryCollectionDone: canCloseInventory(current),
    }))
    const finished = session.state.inventoryCollectionDone
    await sendAndLog(conversationId, to, finished
      ? await nextQuestion(session.state)
      : 'Todavía hay fotos sin identificar o falta un mueble. Escribe qué aparece en la foto pendiente para completar el inventario.')
    return
  }

  if (section === 5 && state.pendingInventory.length > 0 && message.text) {
    const resolved = resolvePendingInventoryChoice(state, message.text)
    if (resolved) {
      session = await mutateQuoteSessionAtomically(session.id, (current) => resolvePendingInventoryChoice(current, message.text) || current)
      state = session.state
      await logAction({ conversationId, action: 'inventory_ambiguity_resolved', payload: { answer: message.text } })
      await sendAndLog(conversationId, to, pendingInventoryQuestion(state) || await nextQuestion(state))
      return
    }
  }

  // Las correcciones QUITAR + AGREGAR tienen prioridad sobre el parser de
  // inventario. Nunca interpretar el mensaje entero como una simple adición.
  if (section === 7 && message.type === 'text' && parseInventoryEdits(message.text) !== null) {
    const result = await editInventory(session.id, message.text)
    if (result.updated) {
      await logAction({ conversationId, action: 'inventory_edited_atomically', payload: {
        messageId: message.id, command: message.text, items: result.updated.state.items,
      } })
    }
    await sendAndLog(conversationId, to, result.response)
    return // CONFIRMAR debe llegar en un mensaje POSTERIOR a la revisión.
  }

  const addingLateInventory = (section === 6 || section === 7) && isInventoryAddition(message.text)
  if (message.type === 'image' || section === 5 || addingLateInventory) {
    const isPhoto = message.type === 'image'
    if (isPhoto) {
      // Registrar el mensaje ANTES de usar OpenAI para que la cotización no
      // se finalice mientras hay fotos en vuelo en otras funciones de Vercel.
      session = await mutateQuoteSessionAtomically(session.id, (current) => upsertInventoryPhoto(current, {
        messageId: message.id, status: 'processing', recognized: [],
      }))
    }
    let imageDataUrl: string | null = null
    if (isPhoto && message.imageId) {
      imageDataUrl = await downloadWhatsAppMediaAsDataUrl(message.imageId)
    }
    if (isPhoto && !imageDataUrl) {
      await mutateQuoteSessionAtomically(session.id, (current) => upsertInventoryPhoto(current, {
        messageId: message.id, status: 'needs_description', recognized: [],
      }))
      await sendAndLog(conversationId, to, 'No pude abrir esa fotografía. Dime qué mueble aparece o vuelve a enviarla, por favor.')
      return
    }
    // No continuar con una foto que no haya quedado conservada en Storage.
    // Así la referencia del PDF y del panel corresponde a un archivo real.
    let photoStorage: Awaited<ReturnType<typeof saveQuotePhoto>> | null = null
    if (isPhoto && imageDataUrl) {
      try {
        photoStorage = await saveQuotePhoto(session.id, message.id, imageDataUrl)
      } catch (error) {
        console.error('[WhatsApp webhook] Error guardando original:', error)
        await mutateQuoteSessionAtomically(session.id, (current) => ({
          ...current, inventoryPhotos: (current.inventoryPhotos || []).filter((photo) => photo.messageId !== message.id),
          inventoryCollectionDone: false,
        }))
        await sendAndLog(conversationId, to, 'No pude conservar esa fotografía. Por favor, reenvíala para que quede incluida en tu cotización.')
        return
      }
    }
    let inventory: Awaited<ReturnType<typeof parseWhatsAppInventory>>
    try {
      inventory = await parseWhatsAppInventory(message.text, imageDataUrl)
    } catch (error) {
      if (!isPhoto) throw error
      await mutateQuoteSessionAtomically(session.id, (current) => upsertInventoryPhoto(current, {
        messageId: message.id, status: 'needs_description', recognized: [],
        storagePath: photoStorage?.storagePath,
      }))
      console.error('[WhatsApp webhook] Error al analizar una foto:', error)
      await sendAndLog(conversationId, to, 'No pude analizar esa fotografía. ¿Qué mueble aparece? Lo registraré por texto.')
      return
    }
    await addUsage(conversationId, inventory.usage)
    session = await mutateQuoteSessionAtomically(session.id, (current) => {
      let merged = mergeInventory(current, inventory.statePatch)
      if (isPhoto) {
        merged = upsertInventoryPhoto(merged, {
          messageId: message.id, status: inventory.needsReview ? 'needs_description' : 'done',
          recognized: inventory.recognizedNames, storagePath: photoStorage?.storagePath,
        })
      } else if (inventory.statePatch.items.length > 0 && merged.inventoryPhotos?.some((photo) => photo.status === 'needs_description')) {
        // El cliente describió el mueble de una foto poco clara.
        const unresolved = merged.inventoryPhotos.find((photo) => photo.status === 'needs_description')!
        merged = upsertInventoryPhoto(merged, { ...unresolved, status: 'done', recognized: inventory.recognizedNames })
        // Esta explicación resolvió la foto que había quedado pendiente.
        merged.pendingInventory = []
      }
      if (photoStorage) {
        const photoUrls = new Set(merged.additionalServices.photos || [])
        photoUrls.add(photoStorage.publicUrl)
        merged.additionalServices.photos = Array.from(photoUrls)
      }
      return merged
    })
    state = session.state
    await logAction({
      conversationId, action: 'inventory_parsed',
      payload: { messageId: message.id, summary: inventory.summary, items: inventory.statePatch.items,
        pending: inventory.statePatch.pendingInventory, photos: state.inventoryPhotos?.length },
    })
    if (isPhoto) {
      const count = state.inventoryPhotos?.length || 1
      const names = inventory.recognizedNames.join(', ')
      await sendAndLog(conversationId, to, inventory.needsReview
        ? `Foto ${count} recibida, pero no pude identificar con certeza el mueble. ¿Qué aparece en esa foto?`
        : `✓ Foto ${count}: ${names || 'registrada'}. Envíame las demás y al terminar escribe *LISTO*.`)
    } else if (state.pendingInventory.length) {
      await sendAndLog(conversationId, to, pendingInventoryQuestion(state) || '¿Qué mueble aparece en la foto pendiente?')
    } else if (state.inventoryPhotos?.length && !state.inventoryCollectionDone) {
      await sendAndLog(conversationId, to, 'Gracias, registrado. Si ya enviaste todas las fotos, escribe *LISTO* para revisar el inventario.')
    } else {
      await sendAndLog(conversationId, to, await nextQuestion(state))
    }
    return
  }

  // Servicios adicionales: una decisión binaria por mensaje. No llamar a OpenAI
  // para interpretar un «sí/no» ni aplicar ese sí a varios servicios.
  if (section === 6) {
    const nextServices = answerExtras(state.additionalServices, message.text)
    if (!nextServices) {
      await sendAndLog(conversationId, to, `Para esta pregunta basta con responder *SÍ* o *NO*. 😊\n\n${sectionQuestion(6, state)}`)
      return
    }
    state = { ...state, additionalServices: nextServices }
    session = await saveQuoteSession(session.id, state)
    await sendAndLog(conversationId, to, await nextQuestion(state))
    return
  }

  if (section === 7 && (CONFIRM_QUOTE.test(message.text) || state.confirmed)) {
    await finalizeQuote(session, conversationId, to)
    return
  }

  const parsed = await parseGeneralWhatsAppTurn(section, state, message.text)
  await addUsage(conversationId, parsed.usage)
  state = parsed.state
  // Si el cliente da sus datos y el tipo de documento en un mismo mensaje,
  // guardar ambos sin obligarlo a repetir BOLETA/FACTURA.
  if (section === 1 && !state.taxDocument && state.personalInfo.name && state.personalInfo.email) {
    const choice = parseTaxDocumentChoice(message.text)
    if (choice) {
      state.taxDocument = choice
      if (choice === 'factura') state.personalInfo.isCompany = true
    }
  }
  await logAction({ conversationId, action: 'quote_fields_parsed', payload: { section, patch: parsed.patch } })

  // WhatsApp usa la misma disponibilidad operativa que el formulario web.
  if (section === 2 && state.schedule.date && state.schedule.time) {
    try {
      const slots = await getAvailableSlotsForDate(state.schedule.date)
      if (!slots.some((slot) => slot.time === state.schedule.time)) {
        const requested = state.schedule.time
        state.schedule.time = null
        session = await saveQuoteSession(session.id, state)
        const choices = slots.length
          ? slots.slice(0, 8).map((slot) => slot.time).join(', ')
          : 'No quedan horarios disponibles ese día.'
        await logAction({ conversationId, action: 'schedule_unavailable', payload: { date: state.schedule.date, requested, available: slots.map((slot) => slot.time) } })
        await sendAndLog(conversationId, to, `El horario ${requested} no está disponible para ${state.schedule.date}. ${slots.length ? `Horarios disponibles: ${choices}. ¿Cuál prefieres?` : 'Indícame otra fecha y reviso la disponibilidad.'}`)
        return
      }
    } catch (availabilityError) {
      console.warn('[WhatsApp webhook] No se pudo validar disponibilidad:', availabilityError)
    }
  }

  if (parsed.patch.requestHuman) {
    session = await saveQuoteSession(session.id, state)
    await sendAndLog(conversationId, to, 'La derivación a secretaría está temporalmente desactivada. Puedes continuar tu cotización aquí.')
    return
  }

  session = await saveQuoteSession(session.id, state)
  section = getNextSection(state)

  if (section === 7 && (parsed.patch.explicitConfirmation || CONFIRM_QUOTE.test(message.text))) {
    await finalizeQuote(session, conversationId, to)
    return
  }

  await sendAndLog(conversationId, to, await nextQuestion(state))
}

/**
 * Cuando falla el parser, antes el webhook devolvía 200 a Meta y dejaba
 * al cliente sin respuesta. Avisar solamente durante una cotización
 * autorizada o al intentar activarla explícitamente con COTIZAR.
 * No envía mensajes a otros contactos ni abre sesiones por su cuenta.
 */
export async function notifyMessageProcessingError(message: ReturnType<typeof extractMessages>[number]) {
  const explicitActivation = botCommand(message.text) === 'COTIZAR'
  let activeAuthorizedQuote = false
  try {
    const bot = await ensureBotState(normalizePhone(message.from))
    activeAuthorizedQuote = bot.mode === 'quoting' && !isQuoteExpired(bot)
  } catch (error) {
    console.error('[WhatsApp webhook] No se pudo comprobar el estado tras el error:', error)
  }
  if (!explicitActivation && !activeAuthorizedQuote) return
  try {
    await sendWhatsAppText(message.from, 'No pude procesar tu último mensaje. Por favor, vuelve a enviarlo en texto. Si vuelve a ocurrir, escribe *SALIR* para terminar.')
  } catch (error) {
    console.error('[WhatsApp webhook] No se pudo enviar aviso de error:', error)
  }
}

