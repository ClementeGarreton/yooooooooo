/**
 * Atribucion de Google Ads en el cliente.
 *
 * El cotizador corre en un dominio separado del sitio principal (yomeencargo.cl), asi
 * que la cookie de atribucion del sitio no cruza. Pero el `gclid` SI viaja en la URL
 * (Google auto-tagging + vinculador de conversiones de GTM). Aqui:
 *   1) capturamos el gclid/gbraid/wbraid/UTMs de la URL al cargar la app,
 *   2) los persistimos (localStorage + cookie espejo, 90 dias) para que sobrevivan
 *      todo el flujo de cotizacion,
 *   3) registramos un touchpoint en el collector de Vanlook (ver sendTouchpoint).
 *
 * Los endpoints que crean `quote_prospects` y `bookings` leen `readAttribution()` y lo
 * mandan en el body del submit, para guardar el gclid junto a la conversion.
 *
 * Quien llega sin clic pero desde otro sitio (Google organico, Maps, redes, asistentes de
 * IA) tambien deja su touchpoint, y la cotizacion guarda el visitor id: asi el dashboard
 * sabe de donde vino aunque no sea un anuncio (ver externalReferrerHost).
 *
 * NO se envia PII (nombre/email/telefono) al collector: solo gclid + parametros de URL.
 */

const ATTR_KEY = 'yme_attr'
const MAXAGE_DAYS = 90

// Collector de atribucion de Vanlook (llave publica).
const SITE_KEY = 'vla_yomeencargo_f638fa277a2b11b6ed0d57e8d0c3f2df'
const COLLECT_URL = 'https://data.vanlookstudio.com/api/attribution/collect'
const VID_COOKIE = '_vla'

// Sitios desde los que se vuelve pero que no son un origen: el propio, los pagos y los logins.
const NOT_AN_ORIGIN = /(^|\.)(yomeencargo\.cl|flow\.cl|webpay\.cl|transbank\.cl|mercadopago\.(cl|com)|accounts\.google\.com)$/
const REFERRAL_SENT_KEY = 'yme_attr_referral'

/** Host del sitio externo que trajo la visita, o null si no es un origen (ni el propio). */
export function externalReferrerHost(referrer: string | null | undefined, ownHost: string): string | null {
  if (!referrer) return null
  let host: string
  try {
    host = new URL(referrer).hostname.toLowerCase()
  } catch {
    return null
  }
  return host && host !== ownHost.toLowerCase() && !NOT_AN_ORIGIN.test(host) ? host : null
}

export interface Attribution {
  gclid?: string | null
  gbraid?: string | null
  wbraid?: string | null
  utm_source?: string | null
  utm_medium?: string | null
  utm_campaign?: string | null
  utm_term?: string | null
  utm_content?: string | null
  campaign_id?: string | null
  ad_group_id?: string | null
  ad_id?: string | null
  keyword?: string | null
  landing_url?: string | null
  referrer?: string | null
  ts?: number
}

/**
 * Captura la atribucion de la URL al cargar la app y la persiste.
 * Solo (sobre)escribe si en esta visita llega un click id nuevo (modelo last-touch de
 * pago): un gclid/gbraid/wbraid o un utm_source. Si el usuario recarga o navega sin
 * parametros, se conserva lo ya guardado.
 */
export function captureAttribution(): void {
  if (typeof window === 'undefined') return

  const q = new URLSearchParams(window.location.search)
  const pick = (k: string): string | null => q.get(k) || null

  const incoming: Attribution = {
    gclid: pick('gclid'),
    gbraid: pick('gbraid'),
    wbraid: pick('wbraid'),
    utm_source: pick('utm_source'),
    utm_medium: pick('utm_medium'),
    utm_campaign: pick('utm_campaign'),
    utm_term: pick('utm_term'),
    utm_content: pick('utm_content'),
    campaign_id: pick('campaignid'),
    ad_group_id: pick('adgroupid'),
    ad_id: pick('creative'),
    keyword: pick('keyword') || pick('utm_term'),
    landing_url: window.location.href,
    referrer: document.referrer || null,
  }

  const hasClick = Boolean(
    incoming.gclid || incoming.gbraid || incoming.wbraid || incoming.utm_source
  )
  if (!hasClick) {
    sendReferralTouchpoint(incoming)
    return
  }

  try {
    localStorage.setItem(ATTR_KEY, JSON.stringify({ ...incoming, ts: Date.now() }))
  } catch {
    // localStorage puede fallar (modo privado / bloqueado): seguimos con la cookie.
  }

  // Cookie espejo (por si se pierde localStorage), 90 dias, dominio propio.
  const d = new Date()
  d.setTime(d.getTime() + MAXAGE_DAYS * 864e5)
  const clickId = incoming.gclid || incoming.gbraid || incoming.wbraid || ''
  document.cookie =
    ATTR_KEY +
    '=' +
    encodeURIComponent(clickId) +
    ';expires=' +
    d.toUTCString() +
    ';path=/;SameSite=Lax'

  sendTouchpoint(incoming)
}

/**
 * Lee la atribucion guardada. Expira a los 90 dias. Devuelve {} si no hay nada valido.
 * Usada por los componentes de cliente para adjuntar el gclid al submit.
 */
export function readAttribution(): Attribution {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(ATTR_KEY)
    if (raw) {
      const a = JSON.parse(raw) as Attribution
      if (a.ts && Date.now() - a.ts < MAXAGE_DAYS * 864e5) return a
    }
  } catch {
    // JSON invalido o storage bloqueado: sin atribucion.
  }
  return {}
}

/**
 * Subconjunto de la atribucion que se guarda en la DB del cliente (quote_prospects /
 * bookings). Es lo que se manda en el body del submit; el server nunca sobrescribe un
 * gclid ya guardado.
 */
export function attributionForSubmit(): {
  gclid: string | null
  gbraid: string | null
  wbraid: string | null
  utm_source: string | null
  utm_campaign: string | null
  visitor_id: string | null
} {
  const a = readAttribution()
  return {
    gclid: a.gclid ?? null,
    gbraid: a.gbraid ?? null,
    wbraid: a.wbraid ?? null,
    utm_source: a.utm_source ?? null,
    utm_campaign: a.utm_campaign ?? null,
    visitor_id: typeof window === 'undefined' ? null : getVisitorId(),
  }
}

/**
 * Visita sin clic que llega desde otro sitio: deja su touchpoint, una vez por sesion, sin
 * tocar la atribucion guardada (un clic de pago anterior se conserva). Una visita directa
 * no es un origen y no se registra.
 */
function sendReferralTouchpoint(a: Attribution): void {
  const host = externalReferrerHost(a.referrer, window.location.hostname)
  if (!host) return
  try {
    if (sessionStorage.getItem(REFERRAL_SENT_KEY) === host) return
    sessionStorage.setItem(REFERRAL_SENT_KEY, host)
  } catch {
    // Storage bloqueado: el collector deduplica por su cuenta.
  }
  sendTouchpoint(a)
}

/** Visitor id estable (cookie `_vla`, 90 dias) para deduplicar touchpoints. */
function getVisitorId(): string {
  const m = document.cookie.match(/(?:^|; )_vla=([^;]+)/)
  if (m) return decodeURIComponent(m[1])

  const vid =
    window.crypto && crypto.randomUUID
      ? crypto.randomUUID()
      : 'vla-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2)

  const d = new Date()
  d.setTime(d.getTime() + MAXAGE_DAYS * 864e5)
  document.cookie =
    VID_COOKIE + '=' + vid + ';expires=' + d.toUTCString() + ';path=/;SameSite=Lax'
  return vid
}

/**
 * Registra un touchpoint en el collector de Vanlook para que exista el punto de
 * contacto con la campana aunque el anuncio linkee directo al cotizador. Best-effort:
 * NUNCA bloquea ni rompe el flujo (todo va con .catch()). No envia PII.
 */
function sendTouchpoint(a: Attribution): void {
  try {
    fetch(COLLECT_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-vla-key': SITE_KEY },
      keepalive: true,
      body: JSON.stringify({
        visitor_id: getVisitorId(),
        occurred_at: new Date().toISOString(),
        landing_url: a.landing_url,
        referrer: a.referrer,
        gclid: a.gclid,
        gbraid: a.gbraid,
        wbraid: a.wbraid,
        utm_source: a.utm_source,
        utm_medium: a.utm_medium,
        utm_campaign: a.utm_campaign,
        utm_term: a.utm_term,
        utm_content: a.utm_content,
        campaign_id: a.campaign_id,
        ad_group_id: a.ad_group_id,
        ad_id: a.ad_id,
        keyword: a.keyword,
        device: { lang: navigator.language, ua: navigator.userAgent },
      }),
    }).catch(() => {})
  } catch {
    // Nunca dejar que el touchpoint rompa la carga de la app.
  }
}
