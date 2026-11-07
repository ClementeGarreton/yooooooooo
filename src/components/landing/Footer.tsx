'use client'

import Link from 'next/link'
import Image from 'next/image'
import { Instagram, Mail, Phone } from 'lucide-react'
import { trackEvent } from '@/lib/tracking'
import { companyWhatsAppLink } from '@/lib/whatsapp'
import { botWhatsAppLink } from '@/lib/whatsappBot'

const PHONE = '+56 9 5233 4799'

const SmallPhoneIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92Z"/>
  </svg>
)

const WaIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M.057 24l1.687-6.163a11.867 11.867 0 0 1-1.587-5.946C.16 5.335 5.495 0 12.05 0a11.82 11.82 0 0 1 8.413 3.488 11.82 11.82 0 0 1 3.48 8.414c-.003 6.557-5.338 11.892-11.893 11.892a11.9 11.9 0 0 1-5.688-1.448L.057 24zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884a9.86 9.86 0 0 0 1.51 5.26l-.999 3.648 3.978-1.607zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.612-.916-2.207-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413z"/>
  </svg>
)

export default function Footer() {
  const currentYear = new Date().getFullYear()

  return (
    <footer
      className="bg-[#111827] pt-[72px] pb-10"
      style={{ borderTop: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.6)' }}
    >
      <div className="max-w-[1180px] mx-auto px-6">
        <div className="grid grid-cols-1 md:grid-cols-[1.4fr_1fr_1fr] gap-12">

          {/* Col 1: Logo + tagline + social */}
          <div>
            <Link href="/" className="flex items-center">
              <div className="relative w-16 h-16 flex-shrink-0">
                <Image src="/logo.png" alt="Yo me Encargo" fill className="object-contain" />
              </div>
            </Link>
            <p className="mt-4 text-[15px] leading-[1.6] max-w-[300px]">
              Mudanzas y fletes con precio fijo en la Región Metropolitana y todo Chile. Operando desde 2020.
            </p>
            <div className="mt-4 flex gap-3">
              <a
                href="https://www.instagram.com/yo.me.encargo_"
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => trackEvent('Contact', { method: 'instagram', location: 'footer' })}
                className="w-9 h-9 rounded-xl flex items-center justify-center text-white transition-colors"
                style={{ background: 'rgba(255,255,255,0.08)' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.2)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')}
                aria-label="Instagram"
              >
                <Instagram size={16} />
              </a>
              <a
                href="mailto:contacto@yomeencargo.cl"
                onClick={() => trackEvent('Contact', { method: 'email', location: 'footer' })}
                className="w-9 h-9 rounded-xl flex items-center justify-center text-white transition-colors"
                style={{ background: 'rgba(255,255,255,0.08)' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.2)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')}
                aria-label="Email"
              >
                <Mail size={16} />
              </a>
              <a
                href={companyWhatsAppLink()}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => trackEvent('Contact', { method: 'whatsapp', location: 'footer' })}
                className="w-9 h-9 rounded-xl flex items-center justify-center text-white transition-colors"
                style={{ background: 'rgba(255,255,255,0.08)' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.2)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')}
                aria-label="WhatsApp"
              >
                <Phone size={16} />
              </a>
            </div>
          </div>

          {/* Col 2: Services */}
          <div>
            <h4 className="font-bold text-[13px] tracking-[0.12em] uppercase text-white mb-[18px]">
              Servicios
            </h4>
            <ul className="flex flex-col gap-3">
              {[
                { label: 'Fletes', href: '#servicios' },
                { label: 'Mudanzas', href: '#servicios' },
                { label: 'Traslados de carga', href: '#servicios' },
                { label: 'Cotizar online', href: '/cotizador' },
                { label: 'Blog', href: '/blog' },
              ].map(({ label, href }) => (
                <li key={label}>
                  {href.startsWith('/') ? (
                    <Link
                      href={href}
                      className="text-[15px] transition-colors hover:text-white"
                      style={{ color: 'rgba(255,255,255,0.62)' }}
                    >
                      {label}
                    </Link>
                  ) : (
                    <a
                      href={href}
                      className="text-[15px] transition-colors hover:text-white"
                      style={{ color: 'rgba(255,255,255,0.62)' }}
                    >
                      {label}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </div>

          {/* Col 3: Contact */}
          <div>
            <h4 className="font-bold text-[13px] tracking-[0.12em] uppercase text-white mb-[18px]">
              Contacto
            </h4>
            <div className="flex flex-col gap-3 text-[15px]">
              <a
                href={`tel:${PHONE.replace(/\s/g, '')}`}
                onClick={() => trackEvent('Contact', { method: 'phone', location: 'footer' })}
                className="flex items-center gap-2.5 transition-colors hover:text-white whitespace-nowrap"
                style={{ color: 'rgba(255,255,255,0.62)' }}
              >
                <SmallPhoneIcon /> {PHONE}
              </a>
              <a
                href={companyWhatsAppLink()}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => trackEvent('Contact', { method: 'whatsapp', location: 'footer' })}
                className="flex items-center gap-2.5 transition-colors hover:text-white"
                style={{ color: 'rgba(255,255,255,0.62)' }}
              >
                <WaIcon /> WhatsApp
              </a>
              {/* Asistente automático: una entrada aparte, que no reemplaza ningún botón ni
                  cambia el flujo del sitio. El texto prellenado es lo que lo activa. */}
              <a
                href={botWhatsAppLink()}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => trackEvent('Contact', { method: 'whatsapp_bot', location: 'footer' })}
                className="flex items-center gap-2.5 transition-colors hover:text-white"
                style={{ color: 'rgba(255,255,255,0.62)' }}
              >
                <WaIcon /> Cotizar por WhatsApp (asistente)
              </a>
              <a
                href="mailto:contacto@yomeencargo.cl"
                onClick={() => trackEvent('Contact', { method: 'email', location: 'footer' })}
                className="transition-colors hover:text-white"
                style={{ color: 'rgba(255,255,255,0.62)' }}
              >
                contacto@yomeencargo.cl
              </a>
              <span style={{ color: 'rgba(255,255,255,0.62)' }}>Región Metropolitana · Chile</span>
            </div>
          </div>
        </div>

        {/* Bottom bar */}
        <div
          className="mt-14 pt-6 flex flex-wrap justify-between gap-4 text-[13px]"
          style={{ borderTop: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.45)' }}
        >
          <span>© {currentYear} Yo me Encargo · yomeencargo.cl</span>
          <div className="flex gap-4">
            <Link href="/terminos-y-condiciones" className="hover:text-white/70 transition-colors">
              Términos
            </Link>
            <Link href="/politica-de-privacidad" className="hover:text-white/70 transition-colors">
              Privacidad
            </Link>
            <Link href="/politicas-de-garantia" className="hover:text-white/70 transition-colors">
              Políticas de garantía
            </Link>
            <span>
              Crafted by{' '}
              <a
                href="https://vanlookstudio.com"
                target="_blank"
                rel="noopener noreferrer"
                className="transition-colors hover:text-white"
                style={{ color: 'rgba(255,255,255,0.6)' }}
              >
                vanlookstudio.com
              </a>
            </span>
          </div>
        </div>
      </div>
    </footer>
  )
}
