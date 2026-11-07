/**
 * ENTRADA AL ASISTENTE DE WHATSAPP. Sin dependencias de servidor: lo usan el footer (el
 * enlace) y el webhook (para reconocer a quien entró por ese enlace).
 *
 * El asistente comparte el número con la atención de siempre (Coexistencia). Para no
 * meterse en las conversaciones normales, solo le responde a quien llega con el texto de
 * este enlace: el resto de los mensajes al número sigue llegando a una persona, como hoy.
 */

/** Número del asistente, el mismo de la atención por WhatsApp. Solo dígitos, con código de país. */
export const BOT_WHATSAPP_NUMBER = '56954390267'

/** Texto que deja escrito el enlace del footer. */
export const BOT_TRIGGER_TEXT = 'Hola, quiero cotizar mi mudanza con el asistente automático'

/** ¿Es el mensaje del enlace? Tolera tildes, mayúsculas y que la persona edite el resto. */
export function isBotTrigger(text: string | null | undefined): boolean {
  return /asistente\s+autom[aá]tico/i.test(String(text || ''))
}

export function botWhatsAppLink(): string {
  return `https://wa.me/${BOT_WHATSAPP_NUMBER}?text=${encodeURIComponent(BOT_TRIGGER_TEXT)}`
}
