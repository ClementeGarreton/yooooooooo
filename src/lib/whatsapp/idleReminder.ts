/* Regla pura para determinar cuándo enviar el recordatorio de inactividad. */
const AFTER_MS = 10 * 60 * 1000
const WITHIN_MS = 23 * 60 * 60 * 1000

export function shouldSendIdleReminder(params: {
  now: number; lastActivityAt: string | null | undefined
  alreadySentFor: string | null | undefined
}): boolean {
  if (!params.lastActivityAt || params.alreadySentFor === params.lastActivityAt) return false
  const elapsed = params.now - Date.parse(params.lastActivityAt)
  return Number.isFinite(elapsed) && elapsed >= AFTER_MS && elapsed < WITHIN_MS
}

