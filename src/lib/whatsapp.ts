/**
 * SALIDAS A WHATSAPP — la única forma de armar un link del sistema.
 *
 * Antes cada pantalla armaba su URL: cuatro normalizadores de teléfono distintos (dos
 * en el MISMO archivo, con reglas que no coincidían), un botón con mensaje y otro sin,
 * y ninguna guarda para el teléfono vacío —que terminaba abriendo WhatsApp sin
 * destinatario—. De ahí salía el «a veces abre el chat equivocado y a veces sin
 * mensaje»: dependía de desde dónde se apretara.
 *
 * Reglas que valen para todos:
 *  - El número se normaliza acá y si no sirve se devuelve `null`: el botón que llama se
 *    deshabilita en vez de abrir un chat vacío.
 *  - El mensaje SIEMPRE va codificado con `encodeURIComponent`.
 *  - Cada cliente abre en su propia pestaña (`openWhatsApp`), no en una compartida:
 *    con una sola ventana para todos, el segundo cliente caía sobre la conversación del
 *    primero.
 */

import { format } from 'date-fns'
import { es } from 'date-fns/locale'

/** WhatsApp de Yo me Encargo, el que ve el público. */
export const COMPANY_WHATSAPP = '56952334799'

/**
 * Teléfono listo para `wa.me`, o `null` si no se puede llamar por WhatsApp.
 *
 * Chile: móvil `9XXXXXXXX`, fijo de 9 dígitos y los 8 dígitos sueltos de toda la vida
 * (se les antepone el 9). Un número que ya viene con `+` de otro país se respeta tal
 * cual: antes se le anteponía «56» y quedaba inservible (`+54 9 11…` → `5654911…`).
 */
export function normalizeWhatsAppPhone(raw?: string | null): string | null {
  const value = String(raw ?? '').trim()
  if (!value) return null

  // `+` o `00` = el número trae su propio código de país.
  const international = value.startsWith('+') || value.startsWith('00')
  let digits = value.replace(/\D/g, '')
  if (value.startsWith('00')) digits = digits.slice(2)
  // Ceros de marcado («09 5233 4799») y los teléfonos de relleno tipo «0000000000».
  digits = digits.replace(/^0+/, '')
  if (!digits) return null

  // Chile: código de país + 9 dígitos. Cualquier otro largo es un número mal cargado.
  if (digits.startsWith('56')) return digits.length === 11 ? digits : null
  if (international) return digits.length >= 8 && digits.length <= 15 ? digits : null
  if (digits.length === 9) return `56${digits}`
  if (digits.length === 8) return `569${digits}`
  return null
}

/** Por qué no se puede escribir por WhatsApp. `null` = sí se puede. */
export function whatsAppUnavailableReason(raw?: string | null): string | null {
  if (!String(raw ?? '').trim()) return 'Este contacto no tiene teléfono cargado'
  if (!normalizeWhatsAppPhone(raw)) return `El teléfono «${String(raw).trim()}» no es válido para WhatsApp`
  return null
}

/**
 * Link a la conversación de un teléfono. `null` si el número no sirve: el que llama
 * decide qué hacer (deshabilitar el botón, ocultarlo), en vez de abrir un chat sin
 * destinatario con el mensaje ya escrito.
 */
export function buildWhatsAppLink(phone?: string | null, message?: string): string | null {
  const normalized = normalizeWhatsAppPhone(phone)
  if (!normalized) return null
  const text = message ? `?text=${encodeURIComponent(message)}` : ''
  return `https://wa.me/${normalized}${text}`
}

/**
 * Link SIN destinatario: abre el selector de contactos de WhatsApp con el mensaje
 * listo. Es lo que corresponde cuando el que comparte elige a quién mandárselo (el
 * link de un camión), no cuando ya sabemos a qué cliente le escribimos.
 */
export function buildWhatsAppShareLink(message: string): string {
  return `https://wa.me/?text=${encodeURIComponent(message)}`
}

/** Link al WhatsApp de la empresa, para el sitio público. */
export function companyWhatsAppLink(message?: string): string {
  return buildWhatsAppLink(COMPANY_WHATSAPP, message) as string
}

/**
 * Abre WhatsApp en la pestaña de ESE contacto.
 *
 * El nombre de ventana se deriva de la clave (el teléfono): dos clientes distintos
 * abren en pestañas distintas y volver a escribirle al mismo reutiliza la suya. Con un
 * nombre fijo para todos —como estaba— el segundo cliente reusaba la ventana del
 * primero y, si ahí ya había una conversación abierta, quedaba en la equivocada.
 */
export function openWhatsApp(link: string, key?: string | null): void {
  const slug = String(key ?? '').replace(/\W/g, '')
  const target = slug ? `whatsapp_${slug}` : '_blank'
  const win = window.open(link, target)
  win?.focus()
}

/** Fecha de una mudanza como se la nombra en un mensaje: «3 de octubre». */
function fechaLarga(scheduledDate?: string | null): string {
  if (!scheduledDate) return ''
  const [y, m, d] = String(scheduledDate).split('-').map(Number)
  if (!y || !m || !d) return ''
  return format(new Date(y, m - 1, d), "d 'de' MMMM", { locale: es })
}

/** «Juan Pérez» → «Juan». Vacío si no hay nombre. */
function primerNombre(name?: string | null): string {
  return String(name ?? '').trim().split(' ')[0] || ''
}

function cuando(scheduledDate?: string | null, scheduledTime?: string | null, preposicion = 'del'): string {
  const fecha = fechaLarga(scheduledDate)
  if (!fecha) return ''
  const hora = scheduledTime ? ` a las ${String(scheduledTime).slice(0, 5)}` : ''
  return ` ${preposicion} ${fecha}${hora}`
}

export interface QuoteContact {
  name?: string | null
  scheduled_date?: string | null
  scheduled_time?: string | null
}

/** Seguimiento de una cotización todavía no reservada. */
export function quoteFollowUpMessage(p: QuoteContact, price?: number | null): string {
  const precioTxt = price ? ` por $${Number(price).toLocaleString('es-CL')}` : ''
  return `Hola ${primerNombre(p.name)}, te contacto de Yo me Encargo por tu cotización de mudanza${cuando(
    p.scheduled_date,
    p.scheduled_time,
    'para el'
  )}${precioTxt}. ¿Cómo estás? Quería coordinar contigo los detalles para asegurar tu fecha.`
}

export interface BookingContact {
  client_name?: string | null
  scheduled_date?: string | null
  scheduled_time?: string | null
}

/** Seguimiento de una reserva ya tomada. Lo usan Reservas y el Dashboard. */
export function bookingFollowUpMessage(b: BookingContact): string {
  return `Hola ${primerNombre(b.client_name)}, te contacto de Yo me Encargo por tu reserva de mudanza${cuando(
    b.scheduled_date,
    b.scheduled_time
  )}. ¿Cómo estás? Quería coordinar contigo los detalles del traslado.`
}

/** Mensaje con el link de pago de una reserva. */
export function paymentLinkMessage(clientName: string, amount: number, url: string): string {
  return `Hola ${clientName}, aquí está el link para pagar tu mudanza con Yo Me Encargo por $${Number(
    amount
  ).toLocaleString('es-CL')}:\n${url}`
}

/** Mensaje con el link de trabajos de un camión y su clave. */
export function driverAccessMessage(label: string, link: string, pin: string): string {
  return `Trabajos de ${label} · Yo Me Encargo:\n${link}\n\nClave de acceso: ${pin}`
}
