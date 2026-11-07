'use client'

import { useEffect, useRef, useState } from 'react'
import { MoreHorizontal, type LucideIcon } from 'lucide-react'

export interface RowMenuItem {
  label: string
  icon?: LucideIcon
  onClick: () => void
  /** Acción destructiva: va en rojo y separada al final. */
  danger?: boolean
  disabled?: boolean
  /** Explicación corta bajo la etiqueta. */
  hint?: string
}

/**
 * Menú «Más» de una fila de tabla: junta las acciones de uso ocasional para que la fila
 * no se estire con una docena de botones. Se dibuja con posición fija, calculada desde el
 * botón, porque las tablas del panel van dentro de un contenedor con scroll horizontal que
 * recortaría un menú común.
 */
export default function RowMenu({ items, label = 'Más acciones' }: { items: (RowMenuItem | false | null | undefined | '' | 0)[]; label?: string }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; right: number; up: boolean }>({ top: 0, right: 0, up: false })
  const button = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const visible = items.filter(Boolean) as RowMenuItem[]

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (!button.current?.contains(t) && !menu.current?.contains(t)) close()
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    // Con posición fija, cualquier scroll o cambio de tamaño lo dejaría flotando lejos.
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  const toggle = () => {
    if (!open && button.current) {
      const r = button.current.getBoundingClientRect()
      // Si abajo no cabe (filas del final de la pantalla), se abre hacia arriba.
      const up = window.innerHeight - r.bottom < Math.min(visible.length * 40 + 16, 360)
      setPos({ top: up ? r.top - 4 : r.bottom + 4, right: window.innerWidth - r.right, up })
    }
    setOpen((v) => !v)
  }

  if (visible.length === 0) return null
  const normal = visible.filter((i) => !i.danger)
  const danger = visible.filter((i) => i.danger)

  const row = (item: RowMenuItem) => {
    const Icon = item.icon
    return (
      <button
        key={item.label}
        type="button"
        disabled={item.disabled}
        onClick={() => {
          setOpen(false)
          item.onClick()
        }}
        className={`flex w-full items-start gap-2.5 px-3 py-2 text-left text-sm transition-colors disabled:opacity-40 ${
          item.danger ? 'text-red-700 hover:bg-red-50' : 'text-gray-800 hover:bg-gray-50'
        }`}
      >
        {Icon && <Icon className="mt-0.5 h-4 w-4 shrink-0" />}
        <span>
          <span className="block font-medium">{item.label}</span>
          {item.hint && <span className="block text-xs text-gray-500">{item.hint}</span>}
        </span>
      </button>
    )
  }

  return (
    <>
      <button
        ref={button}
        type="button"
        onClick={toggle}
        title={label}
        aria-label={label}
        aria-expanded={open}
        className="inline-flex items-center rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-gray-700 transition-colors hover:bg-gray-50"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && (
        <div
          ref={menu}
          role="menu"
          style={{ position: 'fixed', right: pos.right, ...(pos.up ? { bottom: window.innerHeight - pos.top } : { top: pos.top }) }}
          className="z-50 max-h-[360px] w-60 overflow-y-auto rounded-xl border border-gray-200 bg-white py-1 shadow-lg"
        >
          {normal.map(row)}
          {danger.length > 0 && normal.length > 0 && <div className="my-1 border-t border-gray-100" />}
          {danger.map(row)}
        </div>
      )}
    </>
  )
}
