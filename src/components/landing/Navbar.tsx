'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { motion } from 'framer-motion'
import { Home, Route, Truck, Star, HelpCircle, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { trackEvent } from '@/lib/tracking'

const PHONE = '+56 9 5233 4799'

const PhoneIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92Z"/>
  </svg>
)

interface NavItem {
  name: string
  url: string
  icon: LucideIcon
}

const navItems: NavItem[] = [
  { name: 'Inicio',        url: '#top',          icon: Home },
  { name: 'Cómo funciona', url: '#proceso',      icon: Route },
  { name: 'Reseñas',       url: '#testimonios',  icon: Star },
  { name: 'Servicios',     url: '#servicios',    icon: Truck },
  { name: 'Preguntas',     url: '#faq',          icon: HelpCircle },
]

export default function Navbar() {
  const [activeTab, setActiveTab] = useState(navItems[0].name)
  const [isScrolled, setIsScrolled] = useState(false)
  const pathname = usePathname()
  // Fuera de la home las secciones no existen: los links deben volver a "/"
  const isHome = pathname === '/'

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 8)

      // scroll-spy: marca activa la última sección que pasó el primer tercio
      const probe = window.scrollY + window.innerHeight / 3
      let current = navItems[0].name
      for (const item of navItems) {
        const el = document.getElementById(item.url.slice(1))
        if (el && el.getBoundingClientRect().top + window.scrollY <= probe) {
          current = item.name
        }
      }
      setActiveTab(current)
    }

    window.addEventListener('scroll', handleScroll, { passive: true })
    handleScroll()
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  // Ítems con el efecto tubelight (texto en desktop, íconos en mobile)
  const tubelightItems = (layoutId: string, showLabels: boolean) =>
    navItems.map((item) => {
      const Icon = item.icon
      const isActive = activeTab === item.name

      return (
        <a
          key={item.name}
          href={isHome ? item.url : `/${item.url}`}
          onClick={() => setActiveTab(item.name)}
          className={cn(
            'relative cursor-pointer text-sm font-semibold rounded-full transition-colors',
            showLabels ? 'px-4 py-2' : 'px-3.5 py-2.5',
            'text-[#374151] hover:text-[#3F6212]',
            isActive && 'text-[#3F6212]',
          )}
        >
          {showLabels ? (
            <span className="whitespace-nowrap">{item.name}</span>
          ) : (
            <Icon size={18} strokeWidth={2.5} />
          )}
          {isActive && (
            <motion.div
              layoutId={layoutId}
              className="absolute inset-0 w-full bg-[#8CC63F]/10 rounded-full -z-10"
              initial={false}
              transition={{
                type: 'spring',
                stiffness: 300,
                damping: 30,
              }}
            >
              {/* tubo de luz superior */}
              <div className="absolute -top-2 left-1/2 -translate-x-1/2 w-8 h-1 bg-[#8CC63F] rounded-t-full">
                <div className="absolute w-12 h-6 bg-[#8CC63F]/25 rounded-full blur-md -top-2 -left-2" />
                <div className="absolute w-8 h-6 bg-[#8CC63F]/25 rounded-full blur-md -top-1" />
                <div className="absolute w-4 h-4 bg-[#8CC63F]/25 rounded-full blur-sm top-0 left-2" />
              </div>
            </motion.div>
          )}
        </a>
      )
    })

  return (
    <>
      {/* Desktop: todo en un solo pill flotante — logo, links, teléfono y CTA */}
      <nav className="fixed top-3 left-1/2 -translate-x-1/2 z-50 hidden lg:block">
        <div
          className={cn(
            'flex items-center gap-2 border border-[#E5E7EB] backdrop-blur-lg rounded-full py-1.5 pl-2.5 pr-1.5 shadow-lg shadow-black/[0.06] transition-colors duration-200',
            isScrolled ? 'bg-white/90' : 'bg-white/75',
          )}
        >
          <Link href="/" className="flex items-center flex-shrink-0 pr-1">
            <div className="relative w-11 h-11">
              <Image src="/logo.png" alt="Yo me Encargo" fill className="object-contain" priority />
            </div>
          </Link>

          <div className="flex items-center gap-1">
            {tubelightItems('lamp-desktop', true)}
          </div>

          <a
            href={`tel:${PHONE.replace(/\s/g, '')}`}
            onClick={() => trackEvent('Contact', { method: 'phone', location: 'navbar' })}
            className="flex items-center gap-2 font-bold text-[15px] text-[#111827] whitespace-nowrap px-3"
          >
            <span className="text-[#6FA52E]"><PhoneIcon /></span>
            {PHONE}
          </a>

          <Link
            href="/cotizador"
            className="flex items-center justify-center h-11 px-6 bg-[#8CC63F] hover:bg-[#6FA52E] text-[#0E1A05] font-bold text-[15px] rounded-full transition-colors whitespace-nowrap"
          >
            Cotizar Ahora
          </Link>
        </div>
      </nav>

      {/* Mobile: pill superior con logo, teléfono y CTA */}
      <nav className="fixed top-3 left-3 right-3 z-50 lg:hidden">
        <div
          className={cn(
            'flex items-center justify-between border border-[#E5E7EB] backdrop-blur-lg rounded-full py-1.5 pl-2.5 pr-1.5 shadow-lg shadow-black/[0.06] transition-colors duration-200',
            isScrolled ? 'bg-white/90' : 'bg-white/80',
          )}
        >
          <Link href="/" className="flex items-center flex-shrink-0">
            <div className="relative w-10 h-10">
              <Image src="/logo.png" alt="Yo me Encargo" fill className="object-contain" priority />
            </div>
          </Link>

          <div className="flex items-center gap-2">
            <a
              href={`tel:${PHONE.replace(/\s/g, '')}`}
              onClick={() => trackEvent('Contact', { method: 'phone', location: 'navbar_mobile' })}
              aria-label={`Llamar al ${PHONE}`}
              className="flex items-center justify-center h-10 w-10 rounded-full border border-[#E5E7EB] text-[#6FA52E] bg-white/70"
            >
              <PhoneIcon />
            </a>
            <Link
              href="/cotizador"
              className="flex items-center justify-center h-10 px-5 bg-[#8CC63F] hover:bg-[#6FA52E] text-[#0E1A05] font-bold text-[14px] rounded-full transition-colors whitespace-nowrap"
            >
              Cotizar Ahora
            </Link>
          </div>
        </div>
      </nav>

      {/* Mobile: tubelight pill inferior con las secciones — solo en la home,
          en otras páginas tapa los CTAs del contenido */}
      {isHome && (
        <div className="fixed bottom-0 mb-5 left-1/2 -translate-x-1/2 z-50 lg:hidden">
          <div className="flex items-center gap-1 bg-white/75 border border-[#E5E7EB] backdrop-blur-lg py-1 px-1 rounded-full shadow-lg shadow-black/[0.06]">
            {tubelightItems('lamp-mobile', false)}
          </div>
        </div>
      )}
    </>
  )
}
