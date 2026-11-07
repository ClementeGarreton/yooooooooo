import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Pago',
  description: 'Procesa tu pago de forma segura',
  robots: 'noindex, nofollow', // No indexar páginas de pago
}

export default function PagoLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
