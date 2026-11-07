'use client'

import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { ArrowRight } from 'lucide-react'
import { GOOGLE_PROFILE_URL, GOOGLE_REVIEW_URL } from '@/lib/googleProfile'
import type { GoogleReviews } from '@/lib/googleReviews'

interface Testi {
  body: string
  who: string
  ctx: string
  /** Estrellas de la reseña en Google. */
  rating?: number
  authorUrl?: string | null
}

/**
 * Reseñas de la ficha de Google copiadas a mano (Francisco confirmó el 27-10-2026 que son de
 * Google, con 5 estrellas). Se muestran mientras no hay lectura automática: falta
 * GOOGLE_PLACES_API_KEY o Google no responde.
 */
const TESTI: Testi[] = [
  {
    body: 'Coticé un viernes y el lunes ya estaba en mi nueva casa. Precio fijo, sin sorpresas, y cuidaron cada caja.',
    who: 'Camila Soto',
    ctx: 'Mudanza Ñuñoa → Providencia',
    rating: 5,
  },
  {
    body: 'Trasladamos toda la oficina en un fin de semana. Puntuales, ordenados y el equipo súper amable.',
    who: 'Rodrigo Vera',
    ctx: 'Traslado de oficina · Las Condes',
    rating: 5,
  },
  {
    body: 'El flete a regiones llegó intacto y antes de lo previsto. Es la tercera vez que los contrato.',
    who: 'Francisca Lillo',
    ctx: 'Flete Santiago → Concepción',
    rating: 5,
  },
]

const StarIcon = ({ size = 16, filled = true }: { size?: number; filled?: boolean }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" opacity={filled ? 1 : 0.25}>
    <path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
  </svg>
)

const GoogleIcon = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-label="Google">
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z"/>
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"/>
    <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z"/>
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38Z"/>
  </svg>
)

function TestimonialCard({ t }: { t: Testi }) {
  return (
    <div
      className="bg-white rounded-xl p-[30px] flex flex-col shadow-[0_8px_24px_rgba(0,0,0,0.18)]"
      style={{ minHeight: '280px' }}
    >
      <div
        className="font-archivo font-black text-[#F3F4F6]"
        style={{ fontSize: '44px', lineHeight: '0.6', height: '24px' }}
      >
        &ldquo;
      </div>
      <p className="text-[16px] leading-[1.6] text-[#374151] my-3.5 flex-1">{t.body}</p>
      <div className="font-archivo font-extrabold text-[16px] text-[#111827]">
        {t.authorUrl ? (
          <a href={t.authorUrl} target="_blank" rel="noreferrer" className="hover:underline">
            {t.who}
          </a>
        ) : (
          t.who
        )}
      </div>
      <div className="text-[14px] text-[#6B7280] mt-0.5">{t.ctx}</div>
      {t.rating !== undefined && (
        <>
          <div className="flex gap-0.5 mt-4 text-[#F5A623]" aria-label={`${t.rating} de 5 estrellas`}>
            {[0, 1, 2, 3, 4].map((j) => (
              <StarIcon key={j} filled={j < Math.round(t.rating!)} />
            ))}
          </div>
          <div className="flex items-center gap-2 mt-3.5 text-[13px] text-[#6B7280] font-semibold">
            <GoogleIcon /> Reseña en Google
          </div>
        </>
      )}
    </div>
  )
}

const fmtRating = (n: number) => n.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

export default function Testimonials({ google }: { google: GoogleReviews | null }) {
  const [idx, setIdx] = useState(0)
  // Con reseñas de Google se muestran esas (hasta tres, como el diseño); sin ellas, el texto fijo.
  const fromGoogle: Testi[] = (google?.reviews || []).slice(0, 3).map((r) => ({
    body: r.text.length > 320 ? `${r.text.slice(0, 317).trimEnd()}…` : r.text,
    who: r.author,
    ctx: r.when,
    rating: r.rating,
    authorUrl: r.authorUrl,
  }))
  const items = fromGoogle.length > 0 ? fromGoogle : TESTI
  const profileUrl = google?.mapsUrl || GOOGLE_PROFILE_URL
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 900px)')
    const update = () => setIsMobile(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])

  return (
    <section className="py-[120px] bg-[#1A1A2E]" id="testimonios">
      <div className="max-w-[1180px] mx-auto px-6">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="max-w-[640px] mb-14"
        >
          <p
            className="text-[13px] font-bold tracking-[0.18em] uppercase"
            style={{ color: 'rgba(255,255,255,0.55)' }}
          >
            Lo que dicen
          </p>
          <h2
            className="font-archivo font-extrabold text-white mt-3.5 leading-[1.05]"
            style={{ fontSize: 'clamp(30px, 4.4vw, 46px)' }}
          >
            Clientes que volverían a mudarse con nosotros.
          </h2>
        </motion.div>

        {/* Desktop grid */}
        {!isMobile && (
          <div className="grid grid-cols-3 gap-6">
            {items.map((t, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: i * 0.08 }}
              >
                <TestimonialCard t={t} />
              </motion.div>
            ))}
          </div>
        )}

        {/* Mobile carousel */}
        {isMobile && (
          <>
            <div className="overflow-hidden">
              <div
                className="flex"
                style={{ transform: `translateX(-${idx * 100}%)`, transition: 'transform .35s ease' }}
              >
                {items.map((t, i) => (
                  <div key={i} style={{ minWidth: '100%', flex: '0 0 100%' }}>
                    <TestimonialCard t={t} />
                  </div>
                ))}
              </div>
            </div>
            <div className="flex gap-3 justify-center mt-7">
              {items.map((_, i) => (
                <button
                  key={i}
                  aria-label={`Reseña ${i + 1}`}
                  onClick={() => setIdx(i)}
                  className={`w-[9px] h-[9px] rounded-full border-0 cursor-pointer p-0 transition-colors ${
                    i === idx ? 'bg-white' : 'bg-white/30'
                  }`}
                />
              ))}
            </div>
          </>
        )}

        {/* Prueba social primero (lo que ya dicen), y recién después el pedido. */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="mt-11 flex flex-col items-center gap-7"
        >
          <a
            href={profileUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2.5 font-bold text-[16px] text-white pb-1 hover:border-white transition-colors"
            style={{ borderBottom: '1px solid rgba(255,255,255,0.35)' }}
            onMouseEnter={(e) => (e.currentTarget.style.borderBottomColor = '#fff')}
            onMouseLeave={(e) => (e.currentTarget.style.borderBottomColor = 'rgba(255,255,255,0.35)')}
          >
            <GoogleIcon />
            {google?.rating && google.total > 0 ? (
              <>
                <strong>{fmtRating(google.rating)} de 5</strong> en Google · {google.total} reseña{google.total === 1 ? '' : 's'}
              </>
            ) : (
              'Ver reseñas en Google'
            )}
            <ArrowRight size={16} />
          </a>

          <div className="flex flex-col items-center gap-3">
            <a
              href={GOOGLE_REVIEW_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-[56px] items-center gap-2.5 rounded-xl bg-white px-7 text-[18px] font-bold text-[#111827] transition-colors hover:bg-[#F3F4F6]"
            >
              <GoogleIcon size={20} />
              Dejar una reseña
              <span className="flex gap-0.5 text-[#F5A623]" aria-hidden>
                {[0, 1, 2, 3, 4].map((j) => (
                  <StarIcon key={j} size={14} />
                ))}
              </span>
            </a>
            <p className="text-[13px]" style={{ color: 'rgba(255,255,255,0.55)' }}>
              ¿Ya trabajaste con nosotros? Nos ayuda muchísimo.
            </p>
          </div>
        </motion.div>
      </div>
    </section>
  )
}
