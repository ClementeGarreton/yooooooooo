/**
 * Cómo se le llama al servicio en el panel del cliente. Una persona de una empresa ve
 * «trabajo» en vez de «mudanza»: hay empresas que hacen fletes y el panel estaba escrito
 * solo para mudanzas (Francisco, 20-10-2026). Una persona sola sigue viendo «mudanza».
 */
export interface ServiceWords {
  /** «mudanza» / «trabajo». */
  one: string
  /** «Tu próxima mudanza» / «Tu próximo trabajo». */
  next: string
  /** «mudanzas agendadas» / «trabajos agendados». */
  scheduled: string
  /** «Otras mudanzas agendadas» / «Otros trabajos agendados». */
  otherScheduled: string
  /** «Cotizar una mudanza» / «Cotizar un trabajo». */
  quote: string
  /** «Cotiza una mudanza» / «Cotiza un trabajo». */
  quoteNow: string
}

export function serviceWords(isCompany: boolean): ServiceWords {
  return isCompany
    ? {
        one: 'trabajo',
        next: 'Tu próximo trabajo',
        scheduled: 'trabajos agendados',
        otherScheduled: 'Otros trabajos agendados',
        quote: 'Cotizar un trabajo',
        quoteNow: 'Cotiza un trabajo',
      }
    : {
        one: 'mudanza',
        next: 'Tu próxima mudanza',
        scheduled: 'mudanzas agendadas',
        otherScheduled: 'Otras mudanzas agendadas',
        quote: 'Cotizar una mudanza',
        quoteNow: 'Cotiza una mudanza',
      }
}
