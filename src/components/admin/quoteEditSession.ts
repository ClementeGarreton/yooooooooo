'use client'

import { useQuoteStore } from '@/store/quoteStore'

/**
 * Edición de una cotización existente en el cotizador interno (Francisco, 20-10-2026): se
 * abre con sus datos y artículos, y al guardar se actualiza esa misma cotización. Lo que se
 * está editando vive en sessionStorage, igual que el id de la cotización en curso.
 */
export interface QuoteEditSession {
  prospectId: string
  quoteId: string | null
  name: string
  /** false = cotización antigua sin estado completo: hay que volver a elegir las direcciones. */
  hasFullState: boolean
  previousAddresses: { origin: string | null; destination: string | null } | null
  previousPrice: number | null
  /** Reserva que ya tiene la cotización. `paid` = ya pagó: no se reenvían links de pago. */
  booking: { code: string | null; paid: boolean } | null
}

const EDIT_KEY = 'yme_admin_quote_edit'
/** El mismo id de cotización en curso que usa AdminQuoteSummary. */
const QUOTE_ID_KEY = 'yme_admin_quote_id'

export function getQuoteEdit(): QuoteEditSession | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(EDIT_KEY)
    return raw ? (JSON.parse(raw) as QuoteEditSession) : null
  } catch {
    return null
  }
}

export function clearQuoteEdit() {
  if (typeof window !== 'undefined') sessionStorage.removeItem(EDIT_KEY)
}

/** Carga la cotización en el cotizador interno. Después hay que ir a la pestaña «Nueva cotización». */
export async function openQuoteForEdit(prospectId: string): Promise<QuoteEditSession> {
  const res = await fetch(`/api/admin/quotes/${prospectId}`)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.error || 'No se pudo abrir la cotización')
  const { state, personalInfo } = data
  const dateTime =
    state?.dateTime
      ? new Date(state.dateTime)
      : data.scheduledDate && data.scheduledTime
        ? new Date(`${data.scheduledDate}T${data.scheduledTime}:00`)
        : null
  useQuoteStore.getState().resetQuote()
  useQuoteStore.setState({
    personalInfo,
    dateTime,
    isFlexible: Boolean(state?.isFlexible),
    origin: state?.origin || { address: null, details: null },
    destination: state?.destination || { address: null, details: null },
    stops: state?.stops || [],
    items: state?.items || [],
    additionalServices: { ...useQuoteStore.getState().additionalServices, ...(state?.additionalServices || {}) },
  } as any)
  const session: QuoteEditSession = {
    prospectId: data.prospectId,
    quoteId: data.quoteId || null,
    name: personalInfo?.name || personalInfo?.email || 'Cliente',
    hasFullState: Boolean(data.hasFullState),
    previousAddresses: data.previousAddresses || null,
    previousPrice: data.finalPrice ?? null,
    booking: data.booking || null,
  }
  sessionStorage.setItem(EDIT_KEY, JSON.stringify(session))
  if (data.quoteId) sessionStorage.setItem(QUOTE_ID_KEY, data.quoteId)
  else sessionStorage.removeItem(QUOTE_ID_KEY)
  return session
}
