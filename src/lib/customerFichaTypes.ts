// Tipos de la ficha del cliente del admin, SIN dependencias de servidor (los usa el
// componente). Lo que toca la base vive en adminCustomerFicha.ts.

import type { ListedDocument } from '@/components/documents/DocumentList'

export interface CustomerFicha {
  customer: {
    id: string
    code: string
    name: string | null
    email: string
    phone: string | null
    /** RUT confirmado por el equipo: con él entra la primera vez. */
    rut: string | null
    /** RUT que escribió en el cotizador, sin confirmar. */
    rutDeclared: string | null
    hasPassword: boolean
    passwordSetAt: string | null
    /** false = todavía no se corrió add_customer_accounts.sql. */
    accountsAvailable: boolean
    createdAt: string
  }
  company: { id: string; code: string; razon_social: string; role: 'encargado' | 'miembro' } | null
  bookings: {
    id: string
    code: string | null
    quoteId: string | null
    scheduledDate: string | null
    status: string | null
    price: number
    paid: number
    pending: number
  }[]
  quotes: { id: string; code: string | null; value: number; scheduledDate: string | null; isOutstanding: boolean }[]
  requests: { id: string; code: string; label: string; status: string; createdAt: string }[]
  documents: ListedDocument[]
  benefits: {
    referralCode: string | null
    referredCount: number
    completedCount: number
    prizes: { code: string; label: string; state: string }[]
  }
}
