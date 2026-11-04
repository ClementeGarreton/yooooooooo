/** Contadores sin teléfonos de clientes, mensajes, tokens ni datos personales.
 * Permiten distinguir mensajes no recibidos de mensajes descartados por ID. */
export function summarizeWhatsAppWebhook(payload: unknown, allowedIds: readonly string[]) {
  let changes = 0
  let incomingMessages = 0
  let matchedMessages = 0
  let ignoredPhoneMessages = 0
  let statusUpdates = 0
  const entries = payload && typeof payload === 'object' && 'entry' in payload
    ? (payload as { entry?: unknown }).entry : null
  if (!Array.isArray(entries)) {
    return { changes, incomingMessages, matchedMessages, ignoredPhoneMessages, statusUpdates }
  }
  for (const entry of entries) {
    if (!Array.isArray(entry?.changes)) continue
    for (const change of entry.changes) {
      changes += 1
      const value = change?.value
      const phoneId = String(value?.metadata?.phone_number_id || '')
      const count = Array.isArray(value?.messages) ? value.messages.length : 0
      incomingMessages += count
      if (allowedIds.includes(phoneId)) matchedMessages += count
      else ignoredPhoneMessages += count
      statusUpdates += Array.isArray(value?.statuses) ? value.statuses.length : 0
    }
  }
  return { changes, incomingMessages, matchedMessages, ignoredPhoneMessages, statusUpdates }
}
