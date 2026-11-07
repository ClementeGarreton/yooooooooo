import { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Cotización a Domicilio',
  // Sin el monto a propósito: esto es metadata estática, se congela en el build, así que
  // un precio escrito acá seguiría diciendo lo viejo después de cambiarlo en el panel.
  description: 'Servicio de cotización a domicilio en Región Metropolitana. Visita personalizada para evaluar tu mudanza, a precio fijo y descontable del flete.',
  keywords: ['cotización a domicilio', 'visita domicilio', 'evaluación mudanza', 'cotización personalizada'],
  alternates: {
    canonical: 'https://yomeencargo.cl/domicilio',
  },
  openGraph: {
    title: 'Cotización a Domicilio - Yo me Encargo',
    description: 'Te visitamos en tu hogar para realizar una cotización completa y personalizada. Solo RM.',
    url: 'https://yomeencargo.cl/domicilio',
    images: ['/images/hero-truck.jpg'],
  },
}

export default function DomicilioLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
