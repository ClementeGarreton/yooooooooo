// Búsqueda general del panel (barra lateral). SIN dependencias de servidor.

import type { AdminModuleId } from '@/lib/adminModules'

export type SearchKind = 'booking' | 'prospect' | 'customer' | 'company' | 'worker' | 'expense' | 'worker_expense' | 'invoice'

export const SEARCH_KIND_LABEL: Record<SearchKind, string> = {
  booking: 'Reservas y trabajos',
  prospect: 'Cotizaciones',
  customer: 'Clientes',
  company: 'Empresas',
  worker: 'Trabajadores',
  expense: 'Gastos',
  worker_expense: 'Gastos de trabajadores',
  invoice: 'Facturas',
}

export interface SearchHit {
  kind: SearchKind
  id: string
  title: string
  /** Una línea de contexto: fecha, monto, estado, dirección. */
  detail: string
  /** Pestaña del panel que se abre al elegirlo. */
  tab: AdminModuleId
  /** Para Reservas: lo que se escribe en su buscador (ID de la reserva). */
  bookingSearch?: string
}

export interface SearchResults {
  query: string
  hits: SearchHit[]
}
