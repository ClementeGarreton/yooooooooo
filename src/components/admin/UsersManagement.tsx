'use client'

import { useEffect, useState } from 'react'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Modal from '@/components/ui/Modal'
import { UserPlus, KeyRound, UserX, UserCheck, ShieldCheck } from 'lucide-react'
import toast from 'react-hot-toast'

interface AdminUser {
  id: string
  username: string
  display_name: string
  role: 'administrator' | 'staff'
  /** Perfil con permisos. null/undefined antes de correr add_admin_profiles.sql. */
  profile_id?: string | null
  is_active: boolean
  must_change_password: boolean
  created_at: string
  last_login_at: string | null
}

function fmtDateTime(iso: string | null) {
  if (!iso) return 'Nunca'
  const d = new Date(iso)
  return new Intl.DateTimeFormat('es-CL', {
    timeZone: 'America/Santiago',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d)
}

export default function UsersManagement() {
  const [users, setUsers] = useState<AdminUser[]>([])
  // Perfiles con permisos. Vacío = todavía no existen (falta la migración): la pantalla
  // sigue ofreciendo los dos roles de siempre.
  const [profiles, setProfiles] = useState<{ id: string; name: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [showCreate, setShowCreate] = useState(false)
  const [newUser, setNewUser] = useState({
    username: '',
    displayName: '',
    password: '',
    role: 'staff' as 'administrator' | 'staff',
    profileId: '',
  })

  const [resetTarget, setResetTarget] = useState<AdminUser | null>(null)
  const [resetPassword, setResetPassword] = useState('')

  const fetchUsers = async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/admin/users')
      if (!res.ok) throw new Error('Error al cargar')
      setUsers(await res.json())
      const profilesRes = await fetch('/api/admin/profiles')
      const profilesData = profilesRes.ok ? await profilesRes.json().catch(() => ({})) : {}
      setProfiles(Array.isArray(profilesData.profiles) ? profilesData.profiles : [])
    } catch (error) {
      console.error('Error cargando usuarios:', error)
      toast.error('No se pudieron cargar los usuarios')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchUsers()
  }, [])

  const createUser = async () => {
    if (!newUser.username.trim() || !newUser.displayName.trim() || !newUser.password) {
      toast.error('Completa todos los campos')
      return
    }
    if (newUser.password.length < 8) {
      toast.error('La contraseña debe tener al menos 8 caracteres')
      return
    }

    setSaving(true)
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...newUser,
          // Lo que muestra el selector cuando nadie lo tocó: Secretaría, o el primero.
          profileId:
            profiles.length > 0
              ? newUser.profileId || profiles.find((p) => p.name === 'Secretaría')?.id || profiles[0].id
              : undefined,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'No se pudo crear')

      toast.success('Usuario creado. Deberá cambiar la contraseña al entrar.')
      setShowCreate(false)
      setNewUser({ username: '', displayName: '', password: '', role: 'staff', profileId: '' })
      fetchUsers()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo crear el usuario')
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async (user: AdminUser) => {
    try {
      const res = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: user.id, isActive: !user.is_active }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'No se pudo actualizar')

      toast.success(user.is_active ? 'Usuario desactivado' : 'Usuario reactivado')
      fetchUsers()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo actualizar')
    }
  }

  const updateProfile = async (user: AdminUser, profileId: string) => {
    try {
      const res = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: user.id, profileId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'No se pudo cambiar el perfil')

      toast.success('Perfil actualizado')
      fetchUsers()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo cambiar el perfil')
    }
  }

  const updateRole = async (user: AdminUser, role: AdminUser['role']) => {
    try {
      const res = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: user.id, role }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'No se pudo cambiar el perfil')

      toast.success('Perfil actualizado')
      fetchUsers()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo cambiar el perfil')
    }
  }

  const resetUserPassword = async () => {
    if (!resetTarget || resetPassword.length < 8) {
      toast.error('La contraseña debe tener al menos 8 caracteres')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: resetTarget.id, newPassword: resetPassword }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'No se pudo actualizar')

      toast.success('Contraseña reseteada. Deberá cambiarla al entrar.')
      setResetTarget(null)
      setResetPassword('')
      fetchUsers()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo actualizar')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Usuarios del panel</h3>
          <p className="text-sm text-gray-600">
            Administrador puede gestionar usuarios y reajustar montos; Secretaría mantiene la operación diaria.
          </p>
        </div>
        <Button onClick={() => setShowCreate(true)} variant="outline" size="sm">
          <UserPlus className="w-4 h-4 mr-2" />
          Nuevo usuario
        </Button>
      </div>

      <Card className="overflow-hidden">
        {loading ? (
          <div className="py-12 text-center text-gray-600">Cargando usuarios…</div>
        ) : users.length === 0 ? (
          <div className="py-12 text-center text-gray-600">
            No hay usuarios en la tabla. Se está usando el acceso por variables de entorno.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Usuario
                  </th>
                  <th className="hidden sm:table-cell px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Último ingreso
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Perfil
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Estado
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Acciones
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 align-top">
                      <div className="text-sm font-medium text-gray-900">{u.display_name}</div>
                      <div className="text-xs text-gray-500">{u.username}</div>
                    </td>
                    <td className="hidden sm:table-cell px-4 py-3 align-top text-sm text-gray-600">
                      {fmtDateTime(u.last_login_at)}
                    </td>
                    <td className="px-4 py-3 align-top">
                      {profiles.length > 0 ? (
                        <select
                          value={u.profile_id || ''}
                          onChange={(e) => e.target.value && updateProfile(u, e.target.value)}
                          className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                          aria-label={`Perfil de ${u.display_name}`}
                        >
                          {!u.profile_id && <option value="">Sin perfil ({u.role === 'administrator' ? 'Administrador' : 'Secretaría'})</option>}
                          {profiles.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <select
                          value={u.role}
                          onChange={(e) =>
                            updateRole(u, e.target.value as AdminUser['role'])
                          }
                          className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                          aria-label={`Perfil de ${u.display_name}`}
                        >
                          <option value="staff">Secretaría</option>
                          <option value="administrator">Administrador</option>
                        </select>
                      )}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className="flex flex-col gap-1">
                        <span
                          className={`inline-flex w-fit items-center px-2 py-0.5 rounded-full text-xs font-medium border ${
                            u.is_active
                              ? 'bg-green-50 text-green-700 border-green-200'
                              : 'bg-gray-100 text-gray-600 border-gray-200'
                          }`}
                        >
                          {u.is_active ? 'Activo' : 'Desactivado'}
                        </span>
                        {u.must_change_password && (
                          <span className="inline-flex w-fit items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-50 text-amber-700 border border-amber-200">
                            Debe cambiar contraseña
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className="flex flex-wrap gap-2">
                        <Button
                          onClick={() => setResetTarget(u)}
                          variant="outline"
                          size="sm"
                        >
                          <KeyRound className="w-4 h-4 mr-1" />
                          Contraseña
                        </Button>
                        <Button
                          onClick={() => toggleActive(u)}
                          variant="outline"
                          size="sm"
                          className={
                            u.is_active
                              ? 'text-red-600 hover:text-red-700 border-red-200'
                              : 'text-green-700 border-green-200'
                          }
                        >
                          {u.is_active ? (
                            <>
                              <UserX className="w-4 h-4 mr-1" />
                              Desactivar
                            </>
                          ) : (
                            <>
                              <UserCheck className="w-4 h-4 mr-1" />
                              Reactivar
                            </>
                          )}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 p-4">
        <ShieldCheck className="mt-0.5 h-5 w-5 text-blue-600" />
        <div className="text-sm text-blue-900">
          Los usuarios se <strong>desactivan</strong>, no se borran: así el historial de
          Actividad sigue mostrando quién hizo cada cosa. Toda contraseña creada o reseteada
          desde aquí es temporal y su titular debe cambiarla al entrar. Solo el perfil
          <strong> Administrador</strong> puede modificar montos después de un abono.
        </div>
      </div>

      {/* Crear usuario */}
      <Modal isOpen={showCreate} onClose={() => setShowCreate(false)} title="Nuevo usuario">
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Usuario (email)
            </label>
            <Input
              type="email"
              value={newUser.username}
              onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
              placeholder="persona@ejemplo.com"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Nombre para mostrar
            </label>
            <Input
              type="text"
              value={newUser.displayName}
              onChange={(e) => setNewUser({ ...newUser, displayName: e.target.value })}
              placeholder="Nombre y apellido"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Contraseña temporal
            </label>
            <Input
              type="text"
              value={newUser.password}
              onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
              placeholder="Mínimo 8 caracteres"
            />
            <p className="mt-1 text-xs text-gray-500">
              Se la compartes a la persona por un canal seguro. Al entrar, el sistema la
              obliga a cambiarla.
            </p>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Perfil</label>
            {profiles.length > 0 ? (
              <select
                value={newUser.profileId || profiles.find((p) => p.name === 'Secretaría')?.id || profiles[0].id}
                onChange={(e) => setNewUser({ ...newUser, profileId: e.target.value })}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200"
              >
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            ) : (
              <select
                value={newUser.role}
                onChange={(e) =>
                  setNewUser({
                    ...newUser,
                    role: e.target.value as 'administrator' | 'staff',
                  })
                }
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200"
              >
                <option value="staff">Secretaría</option>
                <option value="administrator">Administrador</option>
              </select>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setShowCreate(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button onClick={createUser} disabled={saving}>
              {saving ? 'Creando…' : 'Crear usuario'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Resetear contraseña */}
      <Modal
        isOpen={!!resetTarget}
        onClose={() => {
          setResetTarget(null)
          setResetPassword('')
        }}
        title="Resetear contraseña"
      >
        {resetTarget && (
          <div className="space-y-4">
            <p className="text-sm text-gray-700">
              Nueva contraseña temporal para <strong>{resetTarget.display_name}</strong> (
              {resetTarget.username}).
            </p>
            <Input
              type="text"
              value={resetPassword}
              onChange={(e) => setResetPassword(e.target.value)}
              placeholder="Mínimo 8 caracteres"
            />
            <p className="text-xs text-gray-500">
              Deberá cambiarla la próxima vez que entre.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="outline"
                onClick={() => {
                  setResetTarget(null)
                  setResetPassword('')
                }}
                disabled={saving}
              >
                Cancelar
              </Button>
              <Button onClick={resetUserPassword} disabled={saving}>
                {saving ? 'Guardando…' : 'Resetear'}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
