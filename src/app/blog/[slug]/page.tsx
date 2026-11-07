import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import Navbar from '@/components/landing/Navbar'
import Footer from '@/components/landing/Footer'
import BlogText from '@/components/blog/BlogText'
import { BLOG_POSTS, getBlogPost } from '@/lib/blogPosts'

export const dynamicParams = false

export function generateStaticParams() {
  return BLOG_POSTS.map((p) => ({ slug: p.slug }))
}

export function generateMetadata({ params }: { params: { slug: string } }): Metadata {
  const post = getBlogPost(params.slug)
  if (!post) return {}
  const url = `https://yomeencargo.cl/blog/${post.slug}`
  return {
    title: post.title,
    description: post.description,
    alternates: { canonical: `/blog/${post.slug}` },
    openGraph: {
      type: 'article',
      title: post.title,
      description: post.description,
      url,
      publishedTime: post.date,
      images: ['/images/hero-truck.jpg'],
    },
  }
}

const fmtDate = (d: string) =>
  new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${d}T12:00:00Z`))

export default function BlogPostPage({ params }: { params: { slug: string } }) {
  const post = getBlogPost(params.slug)
  if (!post) notFound()

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.description,
    datePublished: post.date,
    mainEntityOfPage: `https://yomeencargo.cl/blog/${post.slug}`,
    image: 'https://yomeencargo.cl/images/hero-truck.jpg',
    author: { '@type': 'Organization', name: 'Yo me Encargo', url: 'https://yomeencargo.cl' },
    publisher: { '@type': 'Organization', name: 'Yo me Encargo', logo: { '@type': 'ImageObject', url: 'https://yomeencargo.cl/logo.png' } },
  }
  const others = BLOG_POSTS.filter((p) => p.slug !== post.slug).slice(0, 3)

  return (
    <>
      <Navbar />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <main className="pt-28 pb-20 px-6">
        <article className="max-w-[760px] mx-auto">
          <Link href="/blog" className="text-sm font-semibold text-gray-500 hover:text-gray-800">
            ← Blog
          </Link>
          <h1 className="font-archivo text-3xl md:text-[44px] md:leading-[1.1] font-extrabold text-[#111827] mt-4">{post.title}</h1>
          <p className="text-sm text-gray-500 mt-4">
            {fmtDate(post.date)} · Equipo Yo me Encargo
          </p>
          <div className="mt-8">
            <BlogText blocks={post.blocks} />
          </div>

          <div className="mt-12 rounded-xl bg-[#1A1A2E] p-8 text-center">
            <p className="font-archivo text-2xl font-extrabold text-white">¿Cuánto cuesta tu traslado?</p>
            <p className="text-white/70 mt-2">Elige tus artículos y recibe un precio fijo en minutos.</p>
            <Link
              href="/cotizador?start=online"
              className="mt-6 inline-flex h-[52px] items-center rounded-xl bg-[#8CC63F] px-7 font-bold text-[#0E1A05] hover:bg-[#6FA52E] transition-colors"
            >
              Cotizar online
            </Link>
          </div>
        </article>

        {others.length > 0 && (
          <aside className="max-w-[760px] mx-auto mt-16">
            <h2 className="font-archivo text-xl font-extrabold text-[#111827]">Sigue leyendo</h2>
            <ul className="mt-4 space-y-3">
              {others.map((p) => (
                <li key={p.slug}>
                  <Link href={`/blog/${p.slug}`} className="font-semibold text-[#2F7A1F] hover:underline">
                    {p.title}
                  </Link>
                </li>
              ))}
            </ul>
          </aside>
        )}
      </main>
      <Footer />
    </>
  )
}
