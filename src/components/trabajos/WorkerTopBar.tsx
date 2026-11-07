import type { ReactNode } from 'react'
import PanelLogo from '@/components/PanelLogo'
import OfflineSupport from '@/components/trabajos/OfflineSupport'

/**
 * Barra azul de `/trabajos`, la misma del panel del cliente y del admin. `tabs` son las
 * vistas del trabajador con sesión personal (por hacer, historial, documentos); los links
 * por camión no las tienen.
 */
export default function WorkerTopBar({
  label,
  action,
  tabs,
  offline = true,
}: {
  label: string
  action?: ReactNode
  tabs?: { href: string; label: string; active: boolean }[]
  /** Modo sin conexión (guardar las pantallas en el teléfono). false en la vista de administrador. */
  offline?: boolean
}) {
  return (
    <div className="bg-[#1B3A5C] text-white">
      <OfflineSupport enabled={offline} />
      <div className="mx-auto flex max-w-lg items-center justify-between gap-3 px-4 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <PanelLogo size={40} />
          <div className="min-w-0">
            <p className="text-lg font-bold">Yo me encargo!</p>
            <p className="truncate text-xs font-bold tracking-wide text-slate-300">MI EQUIPO · {label}</p>
          </div>
        </div>
        {action}
      </div>
      {tabs && (
        <nav className="mx-auto flex max-w-lg gap-1 overflow-x-auto px-3 pb-2">
          {tabs.map((t) => (
            <a
              key={t.href}
              href={t.href}
              aria-current={t.active ? 'page' : undefined}
              className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold ${
                t.active ? 'bg-[#2A5A85] text-white' : 'text-slate-200'
              }`}
            >
              {t.label}
            </a>
          ))}
        </nav>
      )}
    </div>
  )
}
