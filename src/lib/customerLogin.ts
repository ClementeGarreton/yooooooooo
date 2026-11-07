/**
 * Acceso al Panel del Cliente por link al correo (Módulo 1, punto 1 de la propuesta).
 *
 * Tres decisiones que conviene tener presentes antes de tocar esto:
 *
 *  1) LA RESPUESTA NO DICE SI EL CORREO EXISTE. Pedir un link con un correo que no es
 *     cliente responde exactamente igual que con uno que sí. Si no, el formulario serviría
 *     para averiguar quién se mudó con Yo Me Encargo.
 *
 *  2) EL LINK SE USA UNA VEZ Y VENCE. Se guarda solo el hash del token y se marca usado en
 *     el mismo UPDATE que lo valida (ver consumeLoginToken). Un correo reenviado o leído
 *     días después ya no abre nada.
 *
 *  3) ABRIR EL LINK NO LO GASTA. La página /mi-cuenta/entrar muestra un botón y el canje
 *     es un POST. Los antivirus de correo (Outlook, Gmail) abren los links para revisarlos;
 *     si el GET canjeara, el cliente encontraría su link ya usado sin haberlo tocado.
 */

import { supabaseAdmin } from '@/lib/supabase'
import { claimAndSend, loginScope, normalizeEmail, type SendOutcome } from '@/lib/emailLog'
import { isValidEmail } from '@/lib/emailFormat'
import { siteUrl } from '@/lib/siteUrl'

/** Minutos que dura un link antes de vencer. */
export const LOGIN_LINK_TTL_MIN = 15
/**
 * Links que una misma persona puede pedir dentro de la ventana de abajo. El rate limit
 * del middleware es por IP; esto es por cliente, para que nadie le llene la bandeja a
 * otra persona pidiendo links con su correo desde varias IPs.
 */
const MAX_LINKS_PER_WINDOW = 3
const LINK_WINDOW_MIN = 15

const encoder = new TextEncoder()

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', encoder.encode(value))
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Dominio del link: siempre el público (yomeencargo.cl), nunca el de Vercel, tampoco en un
 * deploy de Preview (Francisco, 16-10-2026; /mi-cuenta ya está en producción).
 *
 * No se usa el Host de la petición a propósito: un Host falseado haría que el correo
 * llevara un link válido hacia un dominio ajeno.
 */
function appUrl(): string {
  return siteUrl()
}

export type LoginLinkResult =
  /** Formato de correo inválido: es lo único que se le dice a quien lo pidió. */
  | { kind: 'invalid_email' }
  /**
   * Todo lo demás. Puertas adentro se distingue para los logs, pero hacia afuera
   * se responde igual en todos los casos (ver punto 1 del encabezado).
   */
  | { kind: 'accepted'; detail: 'sent' | 'not_customer' | 'throttled' | 'send_failed'; outcome?: SendOutcome }

/**
 * Pide un link de acceso para un correo. Si el correo es de un cliente, le manda el link.
 * Nunca lanza: un fallo interno se registra y hacia afuera se ve como "accepted".
 */
export async function requestLoginLink(rawEmail: string, requestedIp: string): Promise<LoginLinkResult> {
  if (!isValidEmail(rawEmail)) return { kind: 'invalid_email' }
  const email = normalizeEmail(rawEmail)

  try {
    const { data: customer, error } = await supabaseAdmin
      .from('customers')
      .select('id, name, email')
      .eq('email', email)
      .maybeSingle()

    if (error) {
      console.error('[customerLogin] Error buscando el cliente:', error)
      return { kind: 'accepted', detail: 'send_failed' }
    }
    if (!customer) return { kind: 'accepted', detail: 'not_customer' }

    const since = new Date(Date.now() - LINK_WINDOW_MIN * 60 * 1000).toISOString()
    const { count, error: countError } = await supabaseAdmin
      .from('customer_login_tokens')
      .select('id', { count: 'exact', head: true })
      .eq('customer_id', customer.id)
      .gte('created_at', since)

    if (countError) {
      console.error('[customerLogin] Error contando links recientes:', countError)
      return { kind: 'accepted', detail: 'send_failed' }
    }
    if ((count || 0) >= MAX_LINKS_PER_WINDOW) {
      console.warn(`[customerLogin] Tope de links alcanzado para ${customer.id}.`)
      return { kind: 'accepted', detail: 'throttled' }
    }

    const token = toBase64Url(globalThis.crypto.getRandomValues(new Uint8Array(32)))
    const expiresAt = new Date(Date.now() + LOGIN_LINK_TTL_MIN * 60 * 1000).toISOString()

    const { data: row, error: insertError } = await supabaseAdmin
      .from('customer_login_tokens')
      .insert({
        customer_id: customer.id,
        token_hash: await sha256Hex(token),
        expires_at: expiresAt,
        requested_ip: requestedIp || null,
      })
      .select('id')
      .single()

    if (insertError || !row) {
      console.error('[customerLogin] No se pudo guardar el link:', insertError)
      return { kind: 'accepted', detail: 'send_failed' }
    }

    const outcome = await claimAndSend({
      emailType: 'cuenta_link_acceso',
      recipient: customer.email,
      scopeKey: loginScope(row.id),
      scheduledFor: new Date(),
      // Lo pidió la persona hace un segundo: no se le retiene por la hora ni por el tope
      // de frecuencia de los correos comerciales.
      transactional: true,
      payload: {
        event: 'customer_login_link',
        cliente: { nombre: customer.name, email: customer.email },
        acceso: {
          url: `${appUrl()}/mi-cuenta/entrar?t=${encodeURIComponent(token)}`,
          vence_minutos: LOGIN_LINK_TTL_MIN,
        },
      },
    })

    const detail = outcome.outcome === 'sent' ? 'sent' : 'send_failed'
    if (detail === 'send_failed') {
      console.warn(`[customerLogin] El link de ${customer.id} no salió:`, outcome)
    }
    return { kind: 'accepted', detail, outcome }
  } catch (e) {
    console.error('[customerLogin] Error inesperado pidiendo link:', e)
    return { kind: 'accepted', detail: 'send_failed' }
  }
}

/**
 * Canjea un link: si es válido, no venció y no se usó, lo marca usado y devuelve el
 * customer_id. Validar y marcar es UN SOLO UPDATE condicionado, así que dos clics
 * simultáneos sobre el mismo link no pueden abrir dos sesiones.
 */
export async function consumeLoginToken(rawToken: string): Promise<string | null> {
  const token = String(rawToken || '').trim()
  if (!token || token.length > 100) return null

  const { data, error } = await supabaseAdmin
    .from('customer_login_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('token_hash', await sha256Hex(token))
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .select('customer_id')
    .maybeSingle()

  if (error) {
    console.error('[customerLogin] Error canjeando el link:', error)
    return null
  }
  return data?.customer_id ?? null
}
