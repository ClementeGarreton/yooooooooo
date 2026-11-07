'use client'

import { useCallback, useEffect, useState } from 'react'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Modal from '@/components/ui/Modal'
import { Plus, ShieldCheck } from 'lucide-react'
import toast from 'react-hot-toast'
import { ADMIN_MODULES, ADMIN_MODULE_GROUPS, ADMIN_SECTION_KEYS, sectionKey, type AdminActionId, type AdminModuleId } from '@/lib/adminModules'
import { storedModuleOn } from '@/lib/adminAccess'
import type { AdminProfile } from '@/lib/adminProfiles'

/**
 * Configuración → Perfiles: qué ve y qué puede hacer cada tipo de usuario del panel. Un
 * interruptor por módulo del menú y, debajo, sus acciones delicadas. Un módulo apagado no
 * aparece en el menú y el servidor rechaza sus llamadas. El perfil Administrador siempre
 * tiene todo y no se edita.
 */

type Switches = { modules: Record<string, boolean>; actions: Record<string, boolean>; sections: Record<string, boolean> }

// Un perfil nuevo parte con todos los subpaneles encendidos: se apagan los que no correspondan.
const ALL_SECTIONS_ON = () => Object.fromEntries(ADMIN_SECTION_KEYS.map((key) => [key, true]))
const EMPTY: Switches = { modules: {}, actions: {}, sections: ALL_SECTIONS_ON() }

function toSwitches(profile: AdminProfile | null): Switches {
  if (!profile) return EMPTY
  const pick = (bag: unknown) =>
    Object.fromEntries(Object.entries((bag as Record<string, unknown>) || {}).map(([k, v]) => [k, v === true]))
  // Los módulos se leen con la misma regla que usa el servidor (un módulo nuevo hereda del
  // que salió), para que el editor muestre lo que el perfil tiene de verdad hoy.
  const modules = Object.fromEntries(ADMIN_MODULES.map((m) => [m.id, storedModuleOn(profile.permissions, m.id)]))
  // Un subpanel está encendido salvo que el perfil lo tenga apagado a propósito.
  const sections = Object.fromEntries(ADMIN_SECTION_KEYS.map((key) => [key, profile.permissions?.sections?.[key] !== false]))
  return { modules, actions: pick(profile.permissions?.actions), sections }
}

async function api(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.error || 'No se pudo completar la acción')
  return data
}

export default function ProfilesManagement() {
  const [profiles, setProfiles] = useState<AdminProfile[]>([])
  const [available, setAvailable] = useState(true)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  /** null = cerrado, 'new' = creando, o el perfil que se edita. */
  const [editing, setEditing] = useState<AdminProfile | 'new' | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [switches, setSwitches] = useState<Switches>(EMPTY)

  const load = useCallback(async () => {
    try {
      const data = await api('/api/admin/profiles', 'GET')
      setProfiles(data.profiles || [])
      setAvailable(data.available !== false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudieron cargar los perfiles')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const open = (target: AdminProfile | 'new') => {
    setEditing(target)
    setName(target === 'new' ? '' : target.name)
    setDescription(target === 'new' ? '' : target.description || '')
    setSwitches(toSwitches(target === 'new' ? null : target))
  }

  const toggleModule = (id: AdminModuleId, actions: AdminActionId[]) =>
    setSwitches((prev) => {
      const on = !prev.modules[id]
      const next = { modules: { ...prev.modules, [id]: on }, actions: { ...prev.actions }, sections: { ...prev.sections } }
      // Apagar un módulo apaga sus acciones: sin el módulo no valen.
      if (!on) for (const a of actions) next.actions[a] = false
      return next
    })

  const save = async () => {
    if (busy || name.trim().length < 2) return
    setBusy(true)
    try {
      const body = { name, description, permissions: switches }
      if (editing === 'new') await api('/api/admin/profiles', 'POST', body)
      else await api(`/api/admin/profiles/${(editing as AdminProfile).id}`, 'PATCH', body)
      toast.success(editing === 'new' ? 'Perfil creado' : 'Perfil guardado')
      setEditing(null)
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo guardar')
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary-600" />
      </div>
    )
  }

  if (!available) {
    return (
      <Card className="p-6">
        <p className="text-sm text-gray-600">
          Falta correr la migración <code>database/migrations/add_admin_profiles.sql</code> para tener perfiles con
          permisos. Mientras tanto siguen los dos roles de siempre: Administrador y Secretaría.
        </p>
      </Card>
    )
  }

  const summary = (p: AdminProfile) => {
    if (p.is_system) return 'Todos los módulos y todas las acciones'
    const on = ADMIN_MODULES.filter((m) => m.fixed || storedModuleOn(p.permissions, m.id))
    return on.map((m) => m.label).join(' · ')
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold text-gray-900">Perfiles</h3>
          <p className="text-sm text-gray-600">
            Qué ve y qué puede hacer cada tipo de usuario. El perfil de cada persona se elige en Usuarios.
          </p>
        </div>
        <Button size="sm" onClick={() => open('new')}>
          <Plus className="mr-2 h-4 w-4" /> Nuevo perfil
        </Button>
      </div>

      <Card className="divide-y divide-gray-100">
        {profiles.map((p) => (
          <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm font-bold text-gray-900">
                {p.is_system && <ShieldCheck className="h-4 w-4 text-primary-600" />}
                {p.name}
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                  {p.userCount} usuario{p.userCount === 1 ? '' : 's'}
                </span>
              </p>
              {p.description && <p className="text-sm text-gray-600">{p.description}</p>}
              <p className="mt-1 text-xs text-gray-500">{summary(p)}</p>
            </div>
            {p.is_system ? (
              <span className="text-xs text-gray-500">Siempre tiene todo; no se edita</span>
            ) : (
              <Button size="sm" variant="outline" onClick={() => open(p)}>
                Editar permisos
              </Button>
            )}
          </div>
        ))}
      </Card>

      <Modal
        isOpen={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'Nuevo perfil' : 'Editar perfil'}
        size="xl"
      >
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Nombre</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. Operaciones" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Descripción (opcional)</label>
              <Input value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
          </div>

          {ADMIN_MODULE_GROUPS.map((group) => (
            <div key={group.label}>
              <p className="mb-1 text-xs font-bold uppercase tracking-wide text-gray-500">{group.label}</p>
              <div className="divide-y divide-gray-100 rounded-lg border border-gray-200">
                {group.modules.map((m) => {
                  const actions = Object.entries(m.actions || {}) as [AdminActionId, string][]
                  const on = Boolean(m.fixed || switches.modules[m.id])
                  return (
                    <div key={m.id} className="p-3">
                      <label className="flex cursor-pointer items-start gap-3">
                        <input
                          type="checkbox"
                          className="mt-1 h-4 w-4"
                          checked={on}
                          disabled={m.fixed}
                          onChange={() => toggleModule(m.id, actions.map(([a]) => a))}
                        />
                        <span>
                          <span className="block text-sm font-semibold text-gray-900">
                            {m.label}
                            {m.fixed && <span className="ml-2 text-xs font-normal text-gray-500">siempre encendido</span>}
                          </span>
                          <span className="block text-xs text-gray-500">{m.description}</span>
                        </span>
                      </label>
                      {(m.sections || []).length > 0 && (
                        <div className="ml-7 mt-2">
                          <p className={`text-xs font-semibold ${on ? 'text-gray-600' : 'text-gray-400'}`}>Subpaneles que ve</p>
                          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                            {(m.sections || []).map((section) => {
                              const key = sectionKey(m.id, section.id)
                              return (
                                <label key={key} className={`flex items-center gap-2 text-sm ${on ? 'text-gray-700' : 'text-gray-400'}`}>
                                  <input
                                    type="checkbox"
                                    className="h-3.5 w-3.5"
                                    disabled={!on}
                                    checked={on && switches.sections[key] !== false}
                                    onChange={(e) => setSwitches((prev) => ({ ...prev, sections: { ...prev.sections, [key]: e.target.checked } }))}
                                  />
                                  {section.label}
                                </label>
                              )
                            })}
                          </div>
                        </div>
                      )}
                      {actions.length > 0 && (
                        <div className="ml-7 mt-2 space-y-1">
                          {actions.map(([key, label]) => (
                            <label key={key} className={`flex items-center gap-2 text-sm ${on ? 'text-gray-700' : 'text-gray-400'}`}>
                              <input
                                type="checkbox"
                                className="h-3.5 w-3.5"
                                disabled={!on}
                                checked={on && Boolean(switches.actions[key])}
                                onChange={(e) =>
                                  setSwitches((prev) => ({ ...prev, actions: { ...prev.actions, [key]: e.target.checked } }))
                                }
                              />
                              {label}
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}

          <p className="text-xs text-gray-500">
            El cambio le llega a los usuarios de este perfil en menos de un minuto, sin que tengan que volver a entrar.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancelar
            </Button>
            <Button onClick={save} disabled={busy || name.trim().length < 2}>
              {busy ? 'Guardando...' : 'Guardar perfil'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
