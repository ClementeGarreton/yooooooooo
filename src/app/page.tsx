import Navbar from '@/components/landing/Navbar'
import Hero from '@/components/landing/Hero'
import ClientLogos from '@/components/landing/ClientLogos'
import HowItWorks from '@/components/landing/HowItWorks'
import WhyChooseUs from '@/components/landing/WhyChooseUs'
import Testimonials from '@/components/landing/Testimonials'
import Servicios from '@/components/landing/Servicios'
import FAQ from '@/components/landing/FAQ'
import CtaFinal from '@/components/landing/CtaFinal'
import Footer from '@/components/landing/Footer'
import { getGoogleReviews } from '@/lib/googleReviews'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  alternates: { canonical: '/' },
}

export default async function HomePage() {
  const google = await getGoogleReviews()

  return (
    <>
      <Navbar />
      <main className="overflow-x-hidden">
        <Hero />
        <ClientLogos />
        <HowItWorks />
        <WhyChooseUs />
        <Testimonials google={google} />
        <Servicios />
        <FAQ />
        <CtaFinal />
      </main>
      <Footer />
    </>
  )
}
