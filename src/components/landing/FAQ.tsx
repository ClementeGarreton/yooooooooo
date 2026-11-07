'use client'

import { useState } from 'react'
import { Plus, MessageCircle } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { trackEvent } from '@/lib/tracking'
import { companyWhatsAppLink } from '@/lib/whatsapp'

const FAQS = [
  {
    q: '¿Cómo calculan el precio?',
    a: 'Según volumen, distancia y accesos. Nuestro cotizador online te entrega el precio exacto y fijo de tu traslado en 3 minutos. Usa el cotizador para más detalles.',
  },
  {
    q: '¿Incluye embalaje?',
    a: 'Sí. Llevamos cajas, film y mantas. Podemos embalar todo por ti o solo lo frágil; tú eliges.',
  },
  {
    q: '¿Trasladan a regiones?',
    a: 'Sí, hacemos fletes interprovinciales a todo Chile con una fecha de entrega comprometida.',
  },
  {
    q: '¿Está asegurada mi carga?',
    a: 'Cada traslado va cubierto. Protegemos y aseguramos tus cosas durante todo el trayecto.',
  },
  {
    q: '¿Con cuánta anticipación agendo?',
    a: 'Idealmente 48 horas, pero según disponibilidad podemos coordinar traslados para el mismo día.',
  },
]

export default function FAQ() {
  const [open, setOpen] = useState<number>(0)

  return (
    <section className="py-[120px] bg-[#F8F8F8]" id="faq">
      <div className="max-w-[1180px] mx-auto px-6">
        <div className="grid grid-cols-1 md:grid-cols-[0.8fr_1.2fr] gap-16 items-start">

          {/* Left: heading + WhatsApp CTA */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <p className="text-[13px] font-bold tracking-[0.18em] uppercase text-[#6B7280]">
              Preguntas frecuentes
            </p>
            <h2
              className="font-archivo font-extrabold text-[#111827] mt-3.5 leading-[1.05]"
              style={{ fontSize: 'clamp(28px, 3.6vw, 40px)' }}
            >
              Resolvemos tus dudas antes de mover una caja.
            </h2>
            <p className="mt-4 text-[16px] text-[#374151] leading-[1.6]">
              ¿Te queda algo en el tintero? Escríbenos por WhatsApp y te respondemos al toque.
            </p>
            <a
              href={companyWhatsAppLink()}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => trackEvent('Contact', { method: 'whatsapp', location: 'faq' })}
              className="mt-6 inline-flex items-center gap-2 h-[46px] px-5 bg-transparent hover:bg-[#111827] text-[#111827] hover:text-white border-2 border-[#111827] font-bold text-[16px] rounded-xl transition-colors"
            >
              <MessageCircle size={18} />
              Hablar con una persona
            </a>
          </motion.div>

          {/* Right: accordion */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="border-t border-[#E5E7EB]"
          >
            {FAQS.map((f, i) => (
              <div key={i} className="border-b border-[#E5E7EB]">
                <button
                  onClick={() => setOpen(open === i ? -1 : i)}
                  aria-expanded={open === i}
                  className="w-full flex items-center justify-between gap-6 py-6 text-left bg-transparent border-0 cursor-pointer"
                >
                  <span className="font-archivo font-extrabold text-[19px] text-[#111827] tracking-[-0.01em]">
                    {f.q}
                  </span>
                  <Plus
                    size={22}
                    className="flex-shrink-0 transition-transform duration-200"
                    style={{
                      color: open === i ? '#6FA52E' : '#6B7280',
                      transform: open === i ? 'rotate(45deg)' : 'rotate(0deg)',
                    }}
                  />
                </button>
                <AnimatePresence>
                  {open === i && (
                    <motion.div
                      initial={{ height: 0 }}
                      animate={{ height: 'auto' }}
                      exit={{ height: 0 }}
                      transition={{ duration: 0.3 }}
                      className="overflow-hidden"
                    >
                      <p className="pb-6 text-[16px] text-[#374151] leading-[1.6] max-w-[560px]">
                        {f.a}
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ))}
          </motion.div>
        </div>
      </div>
    </section>
  )
}
