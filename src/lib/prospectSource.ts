// Origen de marketing de un prospecto: Web / RRSS / Recomendación / Cliente antiguo.
// Compartido por el panel de Prospectos y el de Reservas (para mostrar de dónde viene cada uno).

export type ProspectOrigin = 'web' | 'rrss' | 'recomendacion' | 'cliente_antiguo'

export interface CustomerIdentityRow {
  email?: string | null
  source?: string | null
  status?: string | null
  is_frequent?: boolean | null
  converted_booking_id?: string | null
  lead_key?: string | null
}

export interface CustomerIdentity {
  email: string
  origin: ProspectOrigin
  isFrequent: boolean
  isCustomer: boolean
  hasManualOrigin: boolean
}

export const SOURCE_OPTIONS: { value: ProspectOrigin; label: string }[] = [
  { value: 'web', label: 'Web / cliente nuevo' },
  { value: 'rrss', label: 'RRSS' },
  { value: 'recomendacion', label: 'Recomendación' },
  { value: 'cliente_antiguo', label: 'Cliente antiguo' },
]

// Los orígenes técnicos antiguos (pdf_download, email_quote, checkout_initiated, domicilio)
// se muestran y filtran como "Web" (todos llegaron por el sitio).
export const normalizeOrigin = (source?: string | null): ProspectOrigin =>
  source === 'rrss' || source === 'recomendacion' || source === 'cliente_antiguo' ? source : 'web'

export const normalizeCustomerEmail = (email?: string | null): string =>
  typeof email === 'string' ? email.trim().toLowerCase() : ''

// Consolida la identidad comercial por email. La ficha editada desde Clientes manda
// sobre cualquier cotización; sin ella, "Cliente antiguo" manda sobre los orígenes
// normales. Esto permite conservar varias oportunidades sin duplicar a la persona.
export function buildCustomerIdentityIndex(
  rows: CustomerIdentityRow[]
): Map<string, CustomerIdentity> {
  const identities = new Map<string, CustomerIdentity & { priority: number }>()

  rows.forEach((row) => {
    const email = normalizeCustomerEmail(row.email)
    if (!email) return

    const origin = normalizeOrigin(row.source)
    const hasManualOrigin = String(row.lead_key || '').startsWith('manual_customer:')
    const priority = hasManualOrigin ? 3 : origin === 'cliente_antiguo' ? 2 : 1
    const existing = identities.get(email)

    identities.set(email, {
      email,
      origin: !existing || priority > existing.priority ? origin : existing.origin,
      isFrequent: Boolean(existing?.isFrequent) || Boolean(row.is_frequent),
      isCustomer:
        Boolean(existing?.isCustomer) ||
        hasManualOrigin ||
        row.status === 'converted' ||
        Boolean(row.converted_booking_id),
      hasManualOrigin: Boolean(existing?.hasManualOrigin) || hasManualOrigin,
      priority: Math.max(priority, existing?.priority || 0),
    })
  })

  return identities
}

export function resolveIncomingCustomerSource(
  requestedSource: string,
  identity?: CustomerIdentity
): string {
  return identity?.hasManualOrigin || identity?.origin === 'cliente_antiguo'
    ? identity.origin
    : requestedSource
}

export const getSourceLabel = (source?: string | null): string => {
  switch (normalizeOrigin(source)) {
    case 'rrss':
      return 'RRSS'
    case 'recomendacion':
      return 'Recomendación'
    case 'cliente_antiguo':
      return 'Cliente antiguo'
    default:
      return 'Web'
  }
}

export const getSourceBadge = (source?: string | null): string => {
  switch (normalizeOrigin(source)) {
    case 'rrss':
      return 'bg-pink-100 text-pink-800 border-pink-200'
    case 'recomendacion':
      return 'bg-teal-100 text-teal-800 border-teal-200'
    case 'cliente_antiguo':
      return 'bg-emerald-100 text-emerald-800 border-emerald-300'
    default:
      return 'bg-blue-100 text-blue-800 border-blue-200'
  }
}
