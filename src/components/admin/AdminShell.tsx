'use client'

import { useState } from 'react'
import Image from 'next/image'
import {
  CalendarDays, CalendarCheck2, ClipboardList, Clock3,
  FileText, History, LayoutDashboard, LogOut, Menu, MessageCircle,
  Search, Settings, ShieldCheck, Truck, Users, UserPlus,
  Wallet, X, RefreshCw, KeyRound, LockKeyhole, PlusCircle, Megaphone,
  Building2, BadgeCheck,
} from 'lucide-react'
import type { ReactNode } from 'react'
import './admin-shell.css'

type AdminMenuItem = {
  id: string
  label: string
  icon: typeof LayoutDashboard
  unavailable?: boolean
  link?: string
}

const groups: { title: string; items: AdminMenuItem[] }[] = [
  { title: 'Operación', items: [
    { id: 'dashboard', label: 'Inicio', icon: LayoutDashboard },
    { id: 'approvals', label: 'Por aprobar', icon: BadgeCheck },
    { id: 'calendar', label: 'Calendario', icon: CalendarDays },
    { id: 'bookings', label: 'Reservas', icon: CalendarCheck2 },
    { id: 'jobs', label: 'Trabajos', icon: ClipboardList },
  ] },
  { title: 'Ventas', items: [
    { id: 'prospects', label: 'Prospectos', icon: UserPlus },
    { id: 'new-quote', label: 'Nueva cotización', icon: PlusCircle, link: '/cotizador' },
    { id: 'marketing', label: 'Marketing', icon: Megaphone },
  ] },
  { title: 'Clientes', items: [
    { id: 'customers', label: 'Clientes', icon: Users },
    { id: 'companies', label: 'Empresas', icon: Building2 },
  ] },
  { title: 'Finanzas', items: [
    { id: 'finance', label: 'Finanzas', icon: Wallet },
    { id: 'invoicing', label: 'Emisión de facturas', icon: FileText },
  ] },
  { title: 'Equipo', items: [
    { id: 'fleet', label: 'Flota y equipo', icon: Truck },
    { id: 'schedule', label: 'Horarios', icon: Clock3 },
  ] },
  { title: 'Sistema', items: [
    { id: 'activity', label: 'Actividad', icon: History },
    { id: 'ai-conversations', label: 'Conversaciones IA', icon: MessageCircle },
    { id: 'settings', label: 'Configuración', icon: Settings },
  ] },
]

const sectionDescriptions: Record<string, string> = {
  dashboard: 'Lo de hoy y lo pendiente. La operación de este mes.',
  approvals: 'Solicitudes y reservas que requieren atención.',
  calendar: 'Reservas organizadas por mes y día.',
  bookings: 'Consultar, editar, cobrar y cerrar reservas.',
  jobs: 'Trabajos confirmados y próximas atenciones.',
  prospects: 'Cotizaciones y oportunidades comerciales.',
  customers: 'Personas atendidas y sus fichas.',
  finance: 'Cobros, servicios y resúmenes financieros.',
  marketing: 'Contactos, campañas y referidos.',
  companies: 'Clientes empresas y sus servicios.',
  invoicing: 'Servicios empresariales y base de facturación.',
  fleet: 'Camiones, conductores y accesos.',
  schedule: 'Bloqueos y disponibilidad de la agenda.',
  activity: 'Historial de operaciones del sistema.',
  'ai-conversations': 'Seguimiento de conversaciones automatizadas.',
  settings: 'Precios, horarios, inventario y usuarios.',
}

interface Props {
  activeTab: string
  onSelect: (id: string) => void
  onRefresh: () => void
  onLogout: () => void
  onChangePassword: () => void
  canChangePassword?: boolean
  displayName?: string
  children: ReactNode
}

export default function AdminShell({ activeTab, onSelect, onRefresh, onLogout, onChangePassword, canChangePassword, displayName, children }: Props) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [search, setSearch] = useState('')
  const selected = groups.flatMap(group => group.items).find(item => item.id === activeTab)

  const select = (id: string) => {
    onSelect(id)
    setMenuOpen(false)
    window.scrollTo({ top: 0, behavior: 'auto' })
  }

  const menu = (
    <>
      <div className="admin-brand">
        <div className="admin-brand-mark"><Image src="/logo.png" alt="Yo Me Encargo" width={36} height={36} /></div>
        <div><strong>Yo me encargo!</strong><span>ADMINISTRACIÓN</span></div>
        <button className="admin-close-nav" type="button" aria-label="Cerrar menú" onClick={() => setMenuOpen(false)}><X size={19} /></button>
      </div>
      <div className="admin-menu-search">
        <Search size={16} aria-hidden="true" />
        <input aria-label="Buscar sección del panel" value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar en el panel" />
      </div>
      <nav className="admin-menu-nav" aria-label="Navegación de administración">
        {groups.map(group => {
          const visible = group.items.filter(item => item.label.toLocaleLowerCase('es').includes(search.trim().toLocaleLowerCase('es')))
          if (!visible.length) return null
          return <div className="admin-menu-group" key={group.title}>
            <div className="admin-menu-heading">{group.title}</div>
            {visible.map(item => {
              const Icon = item.icon
              return item.unavailable ? (
                <div key={item.id} className="admin-menu-item admin-menu-item-disabled" title="Este módulo no existe en las API del proyecto entregado; no se han simulado operaciones.">
                  <Icon size={16} aria-hidden="true"/><span>{item.label}</span><LockKeyhole size={12} aria-hidden="true"/>
                </div>
              ) : item.link ? (
                <a key={item.id} className="admin-menu-item" href={item.link} title="Abrir cotizador"><Icon size={16} aria-hidden="true"/><span>{item.label}</span></a>
              ) : (
                <button key={item.id} type="button" className={`admin-menu-item ${activeTab === item.id ? 'is-current' : ''}`} onClick={() => select(item.id)} aria-current={activeTab === item.id ? 'page' : undefined}>
                  <Icon size={16} aria-hidden="true"/><span>{item.label}</span>
                </button>
              )
            })}
          </div>
        })}
        {search && !groups.some(group => group.items.some(item => item.label.toLocaleLowerCase('es').includes(search.trim().toLocaleLowerCase('es')))) && <p className="admin-no-results">No se encontraron secciones.</p>}
      </nav>
      <div className="admin-sidebar-bottom"><span className="admin-connection-indicator"/> Panel conectado a las API existentes</div>
    </>
  )

  return (
    <div className="admin-panel">
      {menuOpen && <button type="button" aria-label="Cerrar menú" onClick={() => setMenuOpen(false)} className="admin-mobile-backdrop"/>}
      <aside className={`admin-sidebar ${menuOpen ? 'admin-sidebar-open' : ''}`}>{menu}</aside>
      <div className="admin-workspace">
        <header className="admin-topbar">
          <div className="admin-page-heading">
            <button type="button" className="admin-open-nav" aria-label="Abrir menú" onClick={() => setMenuOpen(true)}><Menu size={21}/></button>
            <div><div className="admin-breadcrumb">Panel de administración <span>/</span> {selected?.label ?? 'Inicio'}</div>
              <h1>{selected?.label ?? 'Inicio'}</h1>
              <p>{sectionDescriptions[activeTab] || 'Gestión de mudanzas y reservas.'}</p>
            </div>
          </div>
          <div className="admin-topbar-actions">
            <span className="admin-current-user" title={displayName || 'Sesión activa'}><ShieldCheck size={16}/>{displayName || 'Administrador'}</span>
            <button type="button" className="admin-action" onClick={onRefresh} title="Actualizar datos del inicio"><RefreshCw size={17}/><span>Actualizar</span></button>
            {canChangePassword && <button type="button" className="admin-action" onClick={onChangePassword}><KeyRound size={17}/><span>Contraseña</span></button>}
            <button type="button" className="admin-action admin-logout" onClick={onLogout}><LogOut size={17}/><span>Salir</span></button>
          </div>
        </header>
        <main className="admin-main" id="admin-content">{children}</main>
        <footer className="admin-foot">Yo Me Encargo · Administración <span>Panel renovado v3 · Diseño original por <a href="https://vanlookstudio.com" target="_blank" rel="noopener noreferrer">vanlookstudio.com</a> e <a href="https://iaenblanco.com" target="_blank" rel="noopener noreferrer">IAenBlanco</a></span></footer>
      </div>
    </div>
  )
}
