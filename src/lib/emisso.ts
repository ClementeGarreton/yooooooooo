/**
 * Cliente mínimo de Emisso Connect (https://connect.emisso.ai/docs), solo del lado del
 * servidor. Contrato verificado contra su OpenAPI el 03-10-2026.
 *
 * Toda llamada es `POST /api/v1/tools/<tool>/execute` con la entrada en `{ input }`. La
 * respuesta buena trae `{ data, meta }`; la mala, `{ error: { code, message, request_id } }`.
 * Se decide SIEMPRE por `code`, nunca por el texto.
 *
 * La API key (`EMISSO_CONNECT_API_KEY`, o `EMISSO_API_KEY` como nombre anterior) y la conexión (`EMISSO_CONNECTION_ID`, la empresa a cuyo
 * nombre se emite) viven en el entorno del servidor. Nunca salen al navegador ni a un log.
 */

const BASE_URL = 'https://connect.emisso.ai/api/v1/tools'

export interface EmissoError {
  /** Código de Emisso, o 'network' cuando no hubo respuesta (corte, timeout nuestro). */
  code: string
  message: string
  requestId: string | null
  httpStatus: number | null
}

export type EmissoResult<T> = { ok: true; data: T; requestId: string | null } | { ok: false; error: EmissoError }

/** La key vive en Vercel como `EMISSO_CONNECT_API_KEY`; `EMISSO_API_KEY` es el nombre que se usó primero. */
function emissoApiKey(): string | undefined {
  return process.env.EMISSO_CONNECT_API_KEY || process.env.EMISSO_API_KEY
}

export function isEmissoConfigured(): boolean {
  return Boolean(emissoApiKey() && process.env.EMISSO_CONNECTION_ID)
}

export async function callEmisso<T>(
  tool: string,
  input: unknown,
  options: { idempotencyKey?: string; timeoutMs?: number; connectionId?: string } = {}
): Promise<EmissoResult<T>> {
  const apiKey = emissoApiKey()
  // Por defecto, la conexión del SII; un banco u otro sistema pasa la suya.
  const connection = options.connectionId || process.env.EMISSO_CONNECTION_ID
  if (!apiKey || !connection) {
    return { ok: false, error: { code: 'not_configured', message: 'Falta configurar Emisso en el servidor.', requestId: null, httpStatus: null } }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 60_000)
  try {
    const res = await fetch(`${BASE_URL}/${tool}/execute`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'X-Connect-Connection': connection,
        'Content-Type': 'application/json',
        ...(options.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : {}),
      },
      body: JSON.stringify({ input }),
      signal: controller.signal,
      cache: 'no-store',
    })
    const body: any = await res.json().catch(() => null)
    if (res.ok && body && 'data' in body) {
      return { ok: true, data: body.data as T, requestId: body.meta?.request_id || null }
    }
    return {
      ok: false,
      error: {
        code: String(body?.error?.code || `http_${res.status}`),
        message: String(body?.error?.message || 'Emisso respondió con un error.'),
        requestId: body?.error?.request_id || null,
        httpStatus: res.status,
      },
    }
  } catch (error) {
    return {
      ok: false,
      error: {
        code: 'network',
        message: error instanceof Error && error.name === 'AbortError' ? 'Emisso no respondió a tiempo.' : 'No se pudo contactar a Emisso.',
        requestId: null,
        httpStatus: null,
      },
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Errores de `sii.dte.emitir` que la documentación de Emisso («Resultados y errores»)
 * declara ANTERIORES a la salida del documento hacia el SII: el documento no existe y se
 * puede preparar una vista previa nueva. Cualquier otro error al emitir se trata como
 * resultado desconocido.
 */
export const EMISSO_PRE_SEND_ERRORS = new Set([
  'validation_error',
  'sii_dte_validation_failed',
  'scope_not_granted',
  'sii_facturador_not_enabled',
  'sii_facturador_not_enrolled',
  'sii_emitter_profile_required',
  'sii_signing_material_required',
  'sii_preview_token_expired',
  'sii_preview_token_invalid',
  'sii_preview_changed',
  'sii_facturador_contract_changed',
])

/** Errores que piden esperar y repetir con la MISMA clave: el intento sigue vivo. */
export const EMISSO_RETRY_SAME_KEY_ERRORS = new Set(['connection_busy', 'idempotency_in_progress'])

/** ¿Hay key? (sin mirar la conexión: cada sistema tiene la suya). */
export function hasEmissoKey(): boolean {
  return Boolean(emissoApiKey())
}

