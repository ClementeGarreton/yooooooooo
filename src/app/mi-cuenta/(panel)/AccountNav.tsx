'use client'

import { usePathname } from 'next/navigation'
import LogoutButton from '../LogoutButton'
import PanelLogo from '@/components/PanelLogo'

const BASE_LINKS = [
  { href: '/mi-cuenta', label: 'Resumen', exact: true },
  { href: '/mi-cuenta/solicitudes', label: 'Solicitudes' },
  { href: '/mi-cuenta/reservas', label: 'Mis reservas' },
  { href: '/mi-cuenta/cotizaciones', label: 'Cotizaciones' },
  { href: '/mi-cuenta/documentos', label: 'Documentos' },
  { href: '/mi-cuenta/beneficios', label: 'Beneficios' },
]
const COMPANY_LINK = { href: '/mi-cuenta/empresa', label: 'Empresa' }
const DATA_LINK = { href: '/mi-cuenta/datos', label: 'Mis datos' }

/**
 * Navegación del Panel del Cliente: barra lateral en monitor, pestañas horizontales en
 * celular. Mismo azul de los mockups de la propuesta.
 */
export default function AccountNav({
  name,
  code,
  hasCompany = false,
}: {
  name: string
  code: string
  /** «Empresa» solo aparece para quien está asociado a una. */
  hasCompany?: boolean
}) {
  const pathname = usePathname()
  const LINKS: { href: string; label: string; exact?: boolean }[] = [
    ...BASE_LINKS,
    ...(hasCompany ? [COMPANY_LINK] : []),
    DATA_LINK,
  ]
  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`)

  return (
    <>
      {/* Celular: barra superior + pestañas */}
      <div className="bg-[#1B3A5C] text-white lg:hidden">
        <div className="flex items-center justify-between px-4 py-4">
          <a href="/mi-cuenta" className="flex items-center gap-3">
            <PanelLogo size={40} />
            <span>
              <span className="block text-lg font-bold">Yo me encargo!</span>
              <span className="block text-xs font-bold tracking-wide text-slate-300">MI CUENTA</span>
            </span>
          </a>
          <LogoutButton />
        </div>
        <nav className="flex gap-1 overflow-x-auto px-2 pb-2">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold ${
                isActive(l.href, l.exact) ? 'bg-[#2A5A85] text-white' : 'text-slate-200'
              }`}
            >
              {l.label}
            </a>
          ))}
        </nav>
      </div>

      {/* Monitor: barra lateral fija */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col bg-[#1B3A5C] px-5 py-8 text-slate-200 lg:flex">
        <a href="/mi-cuenta" className="flex items-center gap-3 px-2">
          <PanelLogo size={48} />
          <span>
            <span className="block text-xl font-bold leading-tight text-white">Yo me encargo!</span>
            <span className="block text-xs font-bold tracking-wide text-slate-300">MI CUENTA</span>
          </span>
        </a>
        <nav className="mt-10 flex flex-col gap-1">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className={`rounded-xl px-4 py-3 text-[15px] ${
                isActive(l.href, l.exact) ? 'bg-[#2A5A85] font-bold text-white' : 'hover:bg-[#24486F]'
              }`}
            >
              {l.label}
            </a>
          ))}
        </nav>
        <div className="mt-auto rounded-2xl bg-[#24486F] p-4">
          <p className="truncate font-bold text-white">{name}</p>
          <p className="text-sm text-slate-300">{code}</p>
          <div className="mt-3">
            <LogoutButton />
          </div>
        </div>
      </aside>
    </>
  )
}
