'use client'

import type { ReactNode } from 'react'
import {
  BarChart3,
  Building2,
  Calendar,
  CalendarDays,
  ClipboardList,
  Clock,
  FilePlus,
  History,
  Inbox,
  KeyRound,
  LogOut,
  MessageSquareText,
  Megaphone,
  Receipt,
  Wallet,
  Settings,
  Truck,
  UserPlus,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { ADMIN_MODULE_GROUPS, type AdminModuleId } from '@/lib/adminModules'
import PanelLogo from '@/components/PanelLogo'

const ICONS: Record<AdminModuleId, LucideIcon> = {
  dashboard: BarChart3,
  calendar: CalendarDays,
  bookings: Calendar,
  jobs: ClipboardList,
  approvals: Inbox,
  prospects: UserPlus,
  'ai-conversations': MessageSquareText,
  'new-quote': FilePlus,
  marketing: Megaphone,
  customers: Users,
  companies: Building2,
  finance: Wallet,
  invoicing: Receipt,
  fleet: Truck,
  schedule: Clock,
  activity: History,
  settings: Settings,
}

/**
 * Menú del panel: barra lateral fija en monitor, barra superior con pestañas deslizables
 * en celular. Mismo azul y misma forma que el panel del cliente (`AccountNav`), para que
 * todo el sistema se vea como uno solo. Los módulos salen del registro único
 * (`adminModules.ts`); `visible` permite esconder los que el perfil del usuario no tiene.
 */
export default function AdminSidebar({
  active,
  onSelect,
  badges = {},
  visible,
  userName,
  userRole,
  canChangePassword,
  onChangePassword,
  onLogout,
  search,
}: {
  active: string
  onSelect: (id: AdminModuleId) => void
  /** Número a destacar junto a un módulo (p. ej. pendientes en «Por aprobar»). */
  badges?: Partial<Record<AdminModuleId, number>>
  /** Módulos que este usuario puede ver. Sin esto, todos. */
  visible?: (id: AdminModuleId) => boolean
  userName: string
  userRole: string
  canChangePassword: boolean
  onChangePassword: () => void
  onLogout: () => void
  /** Buscador general, arriba del menú. */
  search?: ReactNode
}) {
  const groups = ADMIN_MODULE_GROUPS.map((g) => ({
    ...g,
    modules: g.modules.filter((m) => !visible || visible(m.id)),
  })).filter((g) => g.modules.length > 0)

  const badge = (id: AdminModuleId) =>
    (badges[id] || 0) > 0 ? (
      <span className="ml-auto rounded-full bg-amber-400 px-1.5 text-xs font-bold text-amber-950">{badges[id]}</span>
    ) : null

  return (
    <>
      {/* Celular: barra superior + módulos deslizables */}
      <div className="bg-[#1B3A5C] text-white lg:hidden">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <PanelLogo size={40} />
            <div className="min-w-0">
              <p className="text-lg font-bold">Yo me encargo!</p>
              <p className="truncate text-xs font-bold tracking-wide text-slate-300">ADMINISTRACIÓN · {userName}</p>
            </div>
          </div>
          <button type="button" onClick={onLogout} className="text-sm font-semibold text-slate-200">
            Salir
          </button>
        </div>
        {search && <div className="px-4 pb-2">{search}</div>}
        <nav className="flex gap-1 overflow-x-auto px-2 pb-2">
          {groups.flatMap((g) => g.modules).map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => onSelect(m.id)}
              className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold ${
                active === m.id ? 'bg-[#2A5A85] text-white' : 'text-slate-200'
              }`}
            >
              {m.label}
              {badge(m.id)}
            </button>
          ))}
        </nav>
      </div>

      {/* Monitor: barra lateral fija */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col overflow-y-auto bg-[#1B3A5C] px-4 py-5 text-slate-200 lg:flex">
        <div className="flex items-center gap-3 px-2">
          <PanelLogo size={48} />
          <div>
            <p className="text-xl font-bold leading-tight text-white">Yo me encargo!</p>
            <p className="text-xs font-bold tracking-wide text-slate-300">ADMINISTRACIÓN</p>
          </div>
        </div>

        {search && <div className="mt-4">{search}</div>}

        <nav className="mt-5 flex flex-col gap-3">
          {groups.map((group) => (
            <div key={group.label}>
              <p className="px-3 pb-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">{group.label}</p>
              <div className="flex flex-col gap-0.5">
                {group.modules.map((m) => {
                  const Icon = ICONS[m.id]
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => onSelect(m.id)}
                      aria-current={active === m.id ? 'page' : undefined}
                      className={`flex items-center gap-3 rounded-xl px-3 py-2 text-left text-[15px] transition-colors ${
                        active === m.id ? 'bg-[#2A5A85] font-bold text-white' : 'hover:bg-[#24486F]'
                      }`}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span className="truncate">{m.label}</span>
                      {badge(m.id)}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="mt-auto pt-4">
          <div className="rounded-2xl bg-[#24486F] p-3">
            <p className="truncate font-bold text-white">{userName}</p>
            <p className="text-sm text-slate-300">{userRole}</p>
            <div className="mt-2 flex flex-col gap-1.5 text-sm font-semibold">
              {canChangePassword && (
                <button type="button" onClick={onChangePassword} className="flex items-center gap-2 text-slate-200 hover:text-white">
                  <KeyRound className="h-4 w-4" /> Cambiar contraseña
                </button>
              )}
              <a href="/" className="text-slate-200 hover:text-white">
                ← Ir al cotizador
              </a>
              <button type="button" onClick={onLogout} className="flex items-center gap-2 text-slate-200 hover:text-white">
                <LogOut className="h-4 w-4" /> Cerrar sesión
              </button>
            </div>
          </div>
        </div>
      </aside>
    </>
  )
}
