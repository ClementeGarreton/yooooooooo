/**
 * Lectura de los Google Calendar de Tomás a través de n8n.
 *
 * Por qué pasa por n8n y no por la API de Google directo: los tokens OAuth de las dos
 * cuentas (tomashaichelis@gmail.com y tomas@yomeencargo.cl) ya viven —y se refrescan
 * solos— como credenciales de n8n en core.zensus.cl. Replicarlos acá significaría
 * meter refresh tokens de Google en el .env de la web y mantener el refresco a mano.
 * El workflow "YoMeEncargo · Calendario admin" (id 2WB9CFxqxlDtRecC) expone un webhook
 * que devuelve los eventos ya normalizados.
 *
 * Es SOLO LECTURA: el workflow no crea, edita ni borra nada en Google.
 *
 * Seguridad, en dos capas:
 *  1) la URL del webhook es un UUID impredecible y solo vive en el servidor (nunca
 *     NEXT_PUBLIC_), igual que N8N_QUOTE_WEBHOOK_URL;
 *  2) el workflow tiene un `onlyRunIf` que exige el header `x-yme-token`. Si no
 *     coincide, n8n responde 200 con {"message":"Webhook call received"} y NO ejecuta
 *     nada — por eso acá no alcanza con mirar el status: hay que exigir `events`.
 */

export const N8N_CALENDAR_WEBHOOK_URL = process.env.N8N_CALENDAR_WEBHOOK_URL || ''
const N8N_CALENDAR_TOKEN = process.env.N8N_CALENDAR_TOKEN || ''

/** Clave interna de cada calendario; el color en el panel se elige por esta clave. */
export type GoogleCalendarKey = 'personal' | 'trabajo' | 'contacto'

const CLAVES_VALIDAS: GoogleCalendarKey[] = ['personal', 'trabajo', 'contacto']

export interface GoogleCalendarEvent {
  /** Único en todo el feed: viene como "<calendar>:<id de Google>". */
  id: string
  calendar: GoogleCalendarKey
  calendarLabel: string
  title: string
  /** ISO con offset ('2026-08-17T09:00:00-04:00') o 'YYYY-MM-DD' si es de día completo. */
  start: string | null
  end: string | null
  allDay: boolean
  location: string | null
  description: string | null
  htmlLink: string | null
}

export interface GoogleCalendarFeed {
  /** false = no configurado o falló; el calendario igual muestra las reservas. */
  connected: boolean
  events: GoogleCalendarEvent[]
  error?: string
}

export function isGoogleCalendarConfigured(): boolean {
  return Boolean(N8N_CALENDAR_WEBHOOK_URL && N8N_CALENDAR_TOKEN)
}

/**
 * Trae los eventos de ambos calendarios entre dos instantes ISO.
 *
 * Nunca lanza: un calendario caído no puede dejar sin reservas al panel, así que el
 * fallo se devuelve como `connected: false` + motivo y el llamador decide qué mostrar.
 */
export async function fetchGoogleCalendarEvents(
  timeMin: string,
  timeMax: string,
  opts: { timeoutMs?: number } = {}
): Promise<GoogleCalendarFeed> {
  if (!isGoogleCalendarConfigured()) {
    return {
      connected: false,
      events: [],
      error: 'Faltan N8N_CALENDAR_WEBHOOK_URL o N8N_CALENDAR_TOKEN en el entorno.',
    }
  }

  const timeoutMs = opts.timeoutMs ?? 15000
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const ts = new Date().toISOString()

  try {
    const res = await fetch(N8N_CALENDAR_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-yme-token': N8N_CALENDAR_TOKEN,
      },
      body: JSON.stringify({ timeMin, timeMax }),
      cache: 'no-store',
      signal: controller.signal,
    })
    clearTimeout(timer)

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      const error = `n8n respondió HTTP ${res.status}: ${body.slice(0, 200)}`
      console.error(`[calendar][${ts}] ${error}`)
      return { connected: false, events: [], error }
    }

    const raw = await res.text().catch(() => '')
    let parsed: any = null
    try {
      parsed = raw ? JSON.parse(raw) : null
    } catch {
      parsed = null
    }

    // Token inválido o workflow caído a mitad: n8n igual devuelve 200. La única señal
    // confiable de que el workflow llegó al final es que venga el array `events`.
    if (!parsed || !Array.isArray(parsed.events)) {
      const error = 'n8n no devolvió eventos (token inválido o workflow interrumpido)'
      console.error(`[calendar][${ts}] ${error}. Cuerpo: ${raw.slice(0, 200) || 'vacío'}`)
      return { connected: false, events: [], error }
    }

    const events: GoogleCalendarEvent[] = parsed.events
      .filter((e: any) => e && e.id && e.start)
      .map((e: any) => ({
        id: String(e.id),
        calendar: CLAVES_VALIDAS.includes(e.calendar) ? e.calendar : 'personal',
        calendarLabel: String(e.calendarLabel || ''),
        title: String(e.title || '(sin título)'),
        start: e.start ?? null,
        end: e.end ?? null,
        allDay: Boolean(e.allDay),
        location: e.location ?? null,
        description: e.description ?? null,
        htmlLink: e.htmlLink ?? null,
      }))

    console.info(`[calendar][${ts}] ${events.length} eventos de Google entre ${timeMin} y ${timeMax}`)
    return { connected: true, events }
  } catch (e: any) {
    clearTimeout(timer)
    const isTimeout = e?.name === 'AbortError'
    const error = isTimeout
      ? `n8n no respondió (timeout tras ${timeoutMs}ms)`
      : `error de red contactando n8n: ${e?.message || String(e)}`
    console.error(`[calendar][${ts}] ${error}`)
    return { connected: false, events: [], error }
  }
}
