import Link from 'next/link'
import type { Metadata } from 'next'
import Navbar from '@/components/landing/Navbar'
import Footer from '@/components/landing/Footer'
import { BLOG_POSTS } from '@/lib/blogPosts'

export const metadata: Metadata = {
  title: 'Blog: guías de mudanzas y fletes',
  description: 'Guías para cotizar un flete, preparar tu mudanza, trasladar una oficina o enviar carga a regiones desde Santiago.',
  alternates: { canonical: '/blog' },
  openGraph: {
    title: 'Blog de Yo me Encargo: guías de mudanzas y fletes',
    description: 'Guías para cotizar un flete, preparar tu mudanza, trasladar una oficina o enviar carga a regiones.',
    url: 'https://yomeencargo.cl/blog',
    images: ['/images/hero-truck.jpg'],
  },
}

const fmtDate = (d: string) =>
  new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${d}T12:00:00Z`))

export default function BlogPage() {
  return (
    <>
      <Navbar />
      <main className="pt-28 pb-20 px-6">
        <div className="max-w-[880px] mx-auto">
          <p className="text-[13px] font-bold tracking-[0.18em] uppercase text-gray-500">Blog</p>
          <h1 className="font-archivo text-4xl md:text-5xl font-extrabold text-[#111827] mt-3">Guías de mudanzas y fletes</h1>
          <p className="text-lg text-gray-600 mt-4">
            Lo que conviene saber antes de cotizar y el día del traslado, contado por el equipo de Yo me Encargo.
          </p>
          <ul className="mt-12 grid gap-6">
            {BLOG_POSTS.map((post) => (
              <li key={post.slug}>
                <Link
                  href={`/blog/${post.slug}`}
                  className="block rounded-xl border border-gray-200 p-6 hover:border-[#8CC63F] hover:shadow-md transition"
                >
                  <h2 className="font-archivo text-xl md:text-2xl font-extrabold text-[#111827]">{post.title}</h2>
                  <p className="text-gray-600 mt-2">{post.description}</p>
                  <p className="text-sm text-gray-500 mt-3">{fmtDate(post.date)}</p>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </main>
      <Footer />
    </>
  )
}
