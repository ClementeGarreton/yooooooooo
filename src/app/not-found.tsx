import Link from 'next/link'
import type { Metadata } from 'next'
import Navbar from '@/components/landing/Navbar'
import Footer from '@/components/landing/Footer'

export const metadata: Metadata = {
  title: 'Página no encontrada',
  robots: { index: false, follow: true },
}

export default function NotFound() {
  return (
    <>
      <Navbar />
      <main className="min-h-[70vh] flex items-center justify-center px-6 pt-24 pb-16">
        <div className="max-w-xl text-center">
          <p className="text-sm font-bold uppercase tracking-[0.18em] text-gray-500">Error 404</p>
          <h1 className="font-archivo text-4xl md:text-5xl font-extrabold text-gray-900 mt-3">Esta página no existe</h1>
          <p className="text-lg text-gray-600 mt-4">
            Puede que el enlace esté mal escrito o que la página se haya movido. Si buscabas el precio de tu mudanza o
            flete, lo tienes en el cotizador.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/cotizador?start=online"
              className="inline-flex h-12 items-center justify-center rounded-xl bg-[#8CC63F] px-6 font-bold text-[#0E1A05] hover:bg-[#6FA52E]"
            >
              Cotizar mi mudanza
            </Link>
            <Link
              href="/"
              className="inline-flex h-12 items-center justify-center rounded-xl border border-gray-300 px-6 font-bold text-gray-800 hover:bg-gray-50"
            >
              Ir al inicio
            </Link>
          </div>
        </div>
      </main>
      <Footer />
    </>
  )
}
