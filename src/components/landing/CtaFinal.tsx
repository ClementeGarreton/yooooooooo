'use client'

import Link from 'next/link'
import { motion } from 'framer-motion'
import { ArrowRight, Phone } from 'lucide-react'
import { trackEvent } from '@/lib/tracking'

const PHONE = '+56 9 5233 4799'

export default function CtaFinal() {
  return (
    <section className="bg-[#111827] py-[120px] text-white text-center" id="cotizar">
      <div className="max-w-[1180px] mx-auto px-6">
        <motion.h2
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="font-archivo font-black text-white text-balance tracking-[-0.03em]"
          style={{ fontSize: 'clamp(34px, 5vw, 56px)' }}
        >
          ¿Listo para cotizar?
        </motion.h2>

        <motion.p
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.08 }}
          className="mt-4 text-[19px] max-w-[520px] mx-auto leading-[1.5]"
          style={{ color: 'rgba(255,255,255,0.7)' }}
        >
          Precio fijo en 3 minutos. Sin compromiso, sin letra chica.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.16 }}
          className="mt-10 flex justify-center flex-wrap gap-4"
        >
          <Link
            href="/cotizador?start=online"
            onClick={() => trackEvent('Click', { element: 'cta_final', location: 'cta_section' })}
            className="inline-flex items-center gap-2.5 h-[56px] px-7 bg-[#8CC63F] hover:bg-[#6FA52E] text-[#0E1A05] font-bold text-[18px] rounded-xl transition-colors group"
          >
            Cotizar online
            <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
          </Link>
          <a
            href={`tel:${PHONE.replace(/\s/g, '')}`}
            onClick={() => trackEvent('Contact', { method: 'phone', location: 'cta_section' })}
            className="inline-flex items-center gap-2.5 h-[56px] px-7 bg-transparent text-white font-bold text-[18px] rounded-xl transition-colors hover:bg-white hover:text-[#111827]"
            style={{ border: '2px solid rgba(255,255,255,0.55)' }}
            onMouseEnter={(e) => (e.currentTarget.style.borderColor = '#fff')}
            onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.55)')}
          >
            <Phone size={18} /> Llamar ahora: {PHONE}
          </a>
        </motion.div>
      </div>
    </section>
  )
}
