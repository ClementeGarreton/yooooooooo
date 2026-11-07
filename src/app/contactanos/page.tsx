import Navbar from '@/components/landing/Navbar'
import Contact from '@/components/landing/Contact'
import Footer from '@/components/landing/Footer'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Contáctanos: mudanzas y fletes',
  description: 'Contáctanos para tu mudanza o flete en Santiago y todo Chile. WhatsApp, teléfono y email disponibles. Respuesta rápida y atención personalizada.',
  keywords: ['contacto mudanzas', 'whatsapp mudanzas', 'teléfono fletes', 'contacto yo me encargo'],
  alternates: {
    canonical: 'https://yomeencargo.cl/contactanos',
  },
  openGraph: {
    title: 'Contáctanos - Yo me Encargo',
    description: 'Contáctanos para tu mudanza o flete. Atención rápida y personalizada.',
    url: 'https://yomeencargo.cl/contactanos',
    images: ['/images/hero-truck.jpg'],
  },
}

export default function ContactPage() {
  return (
    <>
      <Navbar />
      <main className="pt-24">
        <Contact />
      </main>
      <Footer />
    </>
  )
}

