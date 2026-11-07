'use client'

import { useState, useEffect } from 'react'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import { Truck, Plus, Minus, AlertCircle, CheckCircle } from 'lucide-react'
import toast from 'react-hot-toast'
import {
  VEHICLE_COLORS,
  nextFreeColorKey,
  resolveVehicleColor,
} from '@/lib/vehicleColors'

interface FleetConfig {
  id: string
  num_vehicles: number
  vehicles?: Vehicle[]
  updated_at: string
}

type VehicleStatus = 'active' | 'maintenance'

interface Vehicle {
  id: number
  name: string
  capacity: number
  status: VehicleStatus
  driver?: string
  phone?: string
  /** Color con el que se identifica en el link de choferes y en Reservas. */
  color?: string
  /** Medidas útiles del cajón, en metros. 0 = sin medir. */
  length?: number
  width?: number
  height?: number
  /** Carga máxima en kilos. 0 = sin definir. */
  maxWeight?: number
}

/** Volumen útil derivado de las medidas. Se calcula, no se guarda, para que no se desincronice. */
function cargoVolume(v: Vehicle): number {
  const l = Number(v.length) || 0
  const w = Number(v.width) || 0
  const h = Number(v.height) || 0
  return l > 0 && w > 0 && h > 0 ? l * w * h : 0
}

// Vehículos por defecto derivados de num_vehicles, usados solo cuando la BD aún no
// tiene la lista materializada (antes de aplicar la migración add_fleet_vehicles.sql).
function buildDefaultVehicles(count: number): Vehicle[] {
  return Array.from({ length: Math.max(count, 1) }, (_, i) => ({
    id: i + 1,
    name: `Camión ${i + 1}`,
    capacity: 1,
    status: 'active' as const,
    driver: '',
    phone: '',
    color: VEHICLE_COLORS[i % VEHICLE_COLORS.length].key
  }))
}

function nextVehicleId(vehicles: Vehicle[]): number {
  return vehicles.reduce((max, v) => Math.max(max, v.id), 0) + 1
}

export default function FleetManagement() {
  const [fleetConfig, setFleetConfig] = useState<FleetConfig | null>(null)
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showAddVehicle, setShowAddVehicle] = useState(false)
  const [newVehicle, setNewVehicle] = useState({
    name: '',
    capacity: 1,
    driver: '',
    phone: '',
    color: VEHICLE_COLORS[0].key
  })

  const openAddVehicle = () => {
    setNewVehicle({
      name: '',
      capacity: 1,
      driver: '',
      phone: '',
      color: nextFreeColorKey(vehicles.map((v) => v.color))
    })
    setShowAddVehicle(true)
  }

  useEffect(() => {
    fetchFleetData()
  }, [])

  const fetchFleetData = async () => {
    try {
      setLoading(true)

      const configResponse = await fetch('/api/admin/fleet-config')
      const configData = await configResponse.json()
      setFleetConfig(configData)

      // Usar los vehículos persistidos; si no existen, derivarlos de num_vehicles.
      const persisted: Vehicle[] = Array.isArray(configData?.vehicles)
        ? configData.vehicles
        : []
      setVehicles(
        persisted.length > 0
          ? persisted
          : buildDefaultVehicles(configData?.num_vehicles || 1)
      )
    } catch (error) {
      console.error('Error fetching fleet data:', error)
      toast.error('Error al cargar la configuración de flota')
    } finally {
      setLoading(false)
    }
  }

  // Persiste la lista completa de vehículos en la BD y sincroniza el estado local.
  // Hace update optimista y revierte si el servidor falla.
  const persistVehicles = async (next: Vehicle[], successMsg?: string) => {
    const previous = vehicles
    setVehicles(next)
    setSaving(true)
    try {
      const response = await fetch('/api/admin/fleet-config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vehicles: next })
      })

      if (!response.ok) {
        throw new Error('Error al actualizar la flota')
      }

      const updatedConfig = await response.json()
      const config = updatedConfig?.config ?? updatedConfig
      setFleetConfig(config)
      if (Array.isArray(config?.vehicles)) {
        setVehicles(config.vehicles)
      }
      if (successMsg) toast.success(successMsg)
      return true
    } catch (error) {
      console.error('Error persisting vehicles:', error)
      setVehicles(previous)
      toast.error('No se pudo guardar el cambio de flota')
      return false
    } finally {
      setSaving(false)
    }
  }

  const updateFleetSize = async (newSize: number) => {
    if (newSize < 1) {
      toast.error('Debe tener al menos 1 vehículo')
      return
    }

    let next: Vehicle[]
    if (newSize > vehicles.length) {
      const toAdd = newSize - vehicles.length
      // Se agregan de a uno para que cada nuevo camión tome un color todavía libre,
      // contando también los que se acaban de crear en esta misma tanda.
      next = [...vehicles]
      for (let i = 0; i < toAdd; i++) {
        next.push({
          id: nextVehicleId(next),
          name: `Camión ${next.length + 1}`,
          capacity: 1,
          status: 'active',
          driver: '',
          phone: '',
          color: nextFreeColorKey(next.map((v) => v.color))
        })
      }
    } else {
      next = vehicles.slice(0, newSize)
    }

    await persistVehicles(next, 'Tamaño de la flota actualizado')
  }

  const addVehicle = async () => {
    if (!newVehicle.name.trim()) {
      toast.error('El nombre del vehículo es requerido')
      return
    }

    const vehicle: Vehicle = {
      id: nextVehicleId(vehicles),
      name: newVehicle.name.trim(),
      capacity: newVehicle.capacity,
      status: 'active',
      driver: newVehicle.driver,
      phone: newVehicle.phone,
      color: newVehicle.color
    }

    const ok = await persistVehicles(
      [...vehicles, vehicle],
      'Vehículo agregado'
    )
    if (ok) {
      setNewVehicle({ name: '', capacity: 1, driver: '', phone: '', color: VEHICLE_COLORS[0].key })
      setShowAddVehicle(false)
    }
  }

  const removeVehicle = async (vehicleId: number) => {
    if (vehicles.length <= 1) {
      toast.error('Debe tener al menos 1 vehículo')
      return
    }
    await persistVehicles(
      vehicles.filter((v) => v.id !== vehicleId),
      'Vehículo eliminado'
    )
  }

  const updateVehicleColor = async (vehicleId: number, color: string) => {
    const next = vehicles.map((v) => (v.id === vehicleId ? { ...v, color } : v))
    await persistVehicles(next, 'Color del camión actualizado')
  }

  // Edición de ficha (nombre, chofer, teléfono, medidas). Se edita en un borrador local y
  // solo se persiste al guardar: así escribir un nombre no dispara un PATCH por tecla.
  const [editingVehicleId, setEditingVehicleId] = useState<number | null>(null)
  const [vehicleDraft, setVehicleDraft] = useState<Vehicle | null>(null)

  const startEditVehicle = (vehicle: Vehicle) => {
    setEditingVehicleId(vehicle.id)
    setVehicleDraft({ ...vehicle })
  }

  const cancelEditVehicle = () => {
    setEditingVehicleId(null)
    setVehicleDraft(null)
  }

  const saveVehicleDraft = async () => {
    if (!vehicleDraft) return
    if (!vehicleDraft.name.trim()) {
      toast.error('El nombre del vehículo es requerido')
      return
    }
    const ok = await persistVehicles(
      vehicles.map((v) => (v.id === vehicleDraft.id ? { ...vehicleDraft, name: vehicleDraft.name.trim() } : v)),
      'Vehículo actualizado'
    )
    if (ok) cancelEditVehicle()
  }

  const updateVehicleStatus = async (vehicleId: number, status: VehicleStatus) => {
    const next = vehicles.map((v) =>
      v.id === vehicleId ? { ...v, status } : v
    )
    await persistVehicles(
      next,
      status === 'maintenance'
        ? 'Vehículo en mantenimiento'
        : 'Vehículo activado'
    )
  }

  const getStatusColor = (status: VehicleStatus) => {
    switch (status) {
      case 'active':
        return 'text-green-600 bg-green-50 border-green-200'
      case 'maintenance':
        return 'text-yellow-600 bg-yellow-50 border-yellow-200'
      default:
        return 'text-gray-600 bg-gray-50 border-gray-200'
    }
  }

  const getStatusLabel = (status: VehicleStatus) =>
    status === 'active' ? 'Activo' : 'Mantenimiento'

  const getStatusIcon = (status: VehicleStatus) =>
    status === 'active' ? (
      <CheckCircle className="w-4 h-4" />
    ) : (
      <AlertCircle className="w-4 h-4" />
    )

  const activeCount = vehicles.filter((v) => v.status === 'active').length
  const maintenanceCount = vehicles.length - activeCount

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Cargando configuración de flota...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Configuración de Flota</h2>
          <p className="text-gray-600">Gestiona tus vehículos y capacidad</p>
        </div>
        <Button onClick={fetchFleetData} variant="outline" size="sm">
          🔄 Actualizar
        </Button>
      </div>

      {/* Fleet Size Configuration */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Tamaño de la Flota</h3>
            <p className="text-sm text-gray-600">
              Ajusta el número total de vehículos disponibles
            </p>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Button
                onClick={() => updateFleetSize(vehicles.length - 1)}
                variant="outline"
                size="sm"
                disabled={saving || vehicles.length <= 1}
              >
                <Minus className="w-4 h-4" />
              </Button>
              <span className="text-2xl font-bold text-gray-900 min-w-[3rem] text-center">
                {vehicles.length}
              </span>
              <Button
                onClick={() => updateFleetSize(vehicles.length + 1)}
                variant="outline"
                size="sm"
                disabled={saving}
              >
                <Plus className="w-4 h-4" />
              </Button>
            </div>
            {saving && (
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary-600"></div>
            )}
          </div>
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-blue-600 mt-0.5" />
            <div className="text-sm text-blue-800">
              <p className="font-semibold mb-1">💡 Importante:</p>
              <p>
                La disponibilidad del cotizador usa los vehículos{' '}
                <strong>activos</strong>. Poner un camión en mantenimiento reduce los
                cupos simultáneos. Ahora mismo: <strong>{activeCount} activo
                {activeCount !== 1 ? 's' : ''}</strong>
                {maintenanceCount > 0 && (
                  <> · {maintenanceCount} en mantenimiento</>
                )}
                .
              </p>
            </div>
          </div>
        </div>
      </Card>

      {/* Vehicles List */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Vehículos</h3>
            <p className="text-sm text-gray-600">
              {vehicles.length} vehículo{vehicles.length !== 1 ? 's' : ''} configurado
              {vehicles.length !== 1 ? 's' : ''} · {activeCount} disponible
              {activeCount !== 1 ? 's' : ''} para operar
            </p>
          </div>
          <Button
            onClick={openAddVehicle}
            variant="outline"
            size="sm"
          >
            <Plus className="w-4 h-4 mr-2" />
            Agregar Vehículo
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {vehicles.map((vehicle, index) => {
            const color = resolveVehicleColor(vehicle, index)
            return (
            <div
              key={vehicle.id}
              className="border border-l-4 border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow"
              style={{ borderLeftColor: color.hex }}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Truck className="w-5 h-5" style={{ color: color.hex }} />
                  <h4 className="font-semibold text-gray-900">{vehicle.name}</h4>
                </div>
                <span
                  className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium border ${getStatusColor(
                    vehicle.status
                  )}`}
                >
                  {getStatusIcon(vehicle.status)}
                  {getStatusLabel(vehicle.status)}
                </span>
              </div>

              {editingVehicleId === vehicle.id && vehicleDraft ? (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Nombre</label>
                    <Input
                      type="text"
                      value={vehicleDraft.name}
                      onChange={(e) => setVehicleDraft({ ...vehicleDraft, name: e.target.value })}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Conductor</label>
                      <Input
                        type="text"
                        value={vehicleDraft.driver || ''}
                        onChange={(e) => setVehicleDraft({ ...vehicleDraft, driver: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Teléfono</label>
                      <Input
                        type="tel"
                        value={vehicleDraft.phone || ''}
                        onChange={(e) => setVehicleDraft({ ...vehicleDraft, phone: e.target.value })}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Medidas del cajón (metros)
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      {(['length', 'width', 'height'] as const).map((dim) => (
                        <Input
                          key={dim}
                          type="number"
                          step="0.1"
                          min="0"
                          placeholder={dim === 'length' ? 'Largo' : dim === 'width' ? 'Ancho' : 'Alto'}
                          value={vehicleDraft[dim] || ''}
                          onChange={(e) =>
                            setVehicleDraft({ ...vehicleDraft, [dim]: Number(e.target.value) || 0 })
                          }
                        />
                      ))}
                    </div>
                    {cargoVolume(vehicleDraft) > 0 && (
                      <p className="mt-1 text-xs text-gray-500">
                        Volumen útil: {cargoVolume(vehicleDraft).toFixed(2)} m³
                      </p>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">
                        Carga máx. (kg)
                      </label>
                      <Input
                        type="number"
                        min="0"
                        value={vehicleDraft.maxWeight || ''}
                        onChange={(e) =>
                          setVehicleDraft({ ...vehicleDraft, maxWeight: Number(e.target.value) || 0 })
                        }
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">
                        Mudanzas simultáneas
                      </label>
                      <Input
                        type="number"
                        min="1"
                        value={vehicleDraft.capacity}
                        onChange={(e) =>
                          setVehicleDraft({ ...vehicleDraft, capacity: Number(e.target.value) || 1 })
                        }
                      />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button onClick={saveVehicleDraft} size="sm" className="flex-1" disabled={saving}>
                      Guardar
                    </Button>
                    <Button onClick={cancelEditVehicle} variant="outline" size="sm" className="flex-1">
                      Cancelar
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2 text-sm text-gray-600">
                  <div className="flex justify-between">
                    <span>Capacidad:</span>
                    <span className="font-medium">
                      {vehicle.capacity} mudanza{vehicle.capacity !== 1 ? 's' : ''}
                    </span>
                  </div>
                  {cargoVolume(vehicle) > 0 && (
                    <div className="flex justify-between">
                      <span>Cajón:</span>
                      <span className="font-medium">
                        {vehicle.length}×{vehicle.width}×{vehicle.height} m ·{' '}
                        {cargoVolume(vehicle).toFixed(1)} m³
                      </span>
                    </div>
                  )}
                  {!!vehicle.maxWeight && (
                    <div className="flex justify-between">
                      <span>Carga máx.:</span>
                      <span className="font-medium">
                        {vehicle.maxWeight.toLocaleString('es-CL')} kg
                      </span>
                    </div>
                  )}
                  {vehicle.driver && (
                    <div className="flex justify-between">
                      <span>Conductor:</span>
                      <span className="font-medium">{vehicle.driver}</span>
                    </div>
                  )}
                  {vehicle.phone && (
                    <div className="flex justify-between">
                      <span>Teléfono:</span>
                      <span className="font-medium">{vehicle.phone}</span>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => startEditVehicle(vehicle)}
                    className="text-xs font-medium text-primary-600 hover:text-primary-700"
                  >
                    Editar ficha
                  </button>
                </div>
              )}

              {/* El color es la referencia que usan los choferes en el link de trabajos:
                  cambiarlo cambia cómo ven su bloque, así que se edita acá y en un solo lugar. */}
              <div className="mt-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-gray-600">Color</span>
                  <span className="text-xs font-medium" style={{ color: color.ink }}>
                    {color.label}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {VEHICLE_COLORS.map((option) => {
                    const selected = option.key === color.key
                    const takenBy = vehicles.find(
                      (v, i) => v.id !== vehicle.id && resolveVehicleColor(v, i).key === option.key
                    )
                    return (
                      <button
                        key={option.key}
                        type="button"
                        onClick={() => updateVehicleColor(vehicle.id, option.key)}
                        disabled={saving || selected}
                        title={
                          takenBy
                            ? `${option.label} — ya lo usa ${takenBy.name}`
                            : option.label
                        }
                        aria-label={`Color ${option.label}`}
                        aria-pressed={selected}
                        className={`h-6 w-6 rounded-full transition-transform hover:scale-110 disabled:hover:scale-100 ${
                          selected ? 'ring-2 ring-offset-2 ring-gray-900' : ''
                        } ${takenBy ? 'opacity-40' : ''}`}
                        style={{ backgroundColor: option.hex }}
                      />
                    )
                  })}
                </div>
              </div>

              <div className="flex gap-2 mt-4">
                <Button
                  onClick={() => updateVehicleStatus(vehicle.id, 'active')}
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  disabled={saving || vehicle.status === 'active'}
                >
                  Activo
                </Button>
                <Button
                  onClick={() => updateVehicleStatus(vehicle.id, 'maintenance')}
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  disabled={saving || vehicle.status === 'maintenance'}
                >
                  Mantenimiento
                </Button>
                <Button
                  onClick={() => removeVehicle(vehicle.id)}
                  variant="outline"
                  size="sm"
                  className="text-red-600 hover:text-red-700"
                  disabled={saving}
                >
                  <Minus className="w-4 h-4" />
                </Button>
              </div>
            </div>
            )
          })}
        </div>
      </Card>

      {/* Add Vehicle Modal */}
      {showAddVehicle && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              Agregar Nuevo Vehículo
            </h3>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Nombre del Vehículo
                </label>
                <Input
                  type="text"
                  value={newVehicle.name}
                  onChange={(e) =>
                    setNewVehicle({ ...newVehicle, name: e.target.value })
                  }
                  placeholder="Ej: Camión 3"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Capacidad (mudanzas simultáneas)
                </label>
                <Input
                  type="number"
                  min="1"
                  value={newVehicle.capacity}
                  onChange={(e) =>
                    setNewVehicle({
                      ...newVehicle,
                      capacity: parseInt(e.target.value) || 1
                    })
                  }
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Conductor (opcional)
                </label>
                <Input
                  type="text"
                  value={newVehicle.driver}
                  onChange={(e) =>
                    setNewVehicle({ ...newVehicle, driver: e.target.value })
                  }
                  placeholder="Nombre del conductor"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Teléfono (opcional)
                </label>
                <Input
                  type="tel"
                  value={newVehicle.phone}
                  onChange={(e) =>
                    setNewVehicle({ ...newVehicle, phone: e.target.value })
                  }
                  placeholder="+56912345678"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Color (con el que lo ven los choferes)
                </label>
                <div className="flex flex-wrap gap-2">
                  {VEHICLE_COLORS.map((option) => {
                    const takenBy = vehicles.find(
                      (v, i) => resolveVehicleColor(v, i).key === option.key
                    )
                    return (
                      <button
                        key={option.key}
                        type="button"
                        onClick={() => setNewVehicle({ ...newVehicle, color: option.key })}
                        title={
                          takenBy ? `${option.label} — ya lo usa ${takenBy.name}` : option.label
                        }
                        aria-label={`Color ${option.label}`}
                        aria-pressed={newVehicle.color === option.key}
                        className={`h-7 w-7 rounded-full transition-transform hover:scale-110 ${
                          newVehicle.color === option.key
                            ? 'ring-2 ring-offset-2 ring-gray-900'
                            : ''
                        } ${takenBy ? 'opacity-40' : ''}`}
                        style={{ backgroundColor: option.hex }}
                      />
                    )
                  })}
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <Button onClick={() => setShowAddVehicle(false)} variant="outline">
                Cancelar
              </Button>
              <Button onClick={addVehicle} disabled={saving}>
                Agregar Vehículo
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
