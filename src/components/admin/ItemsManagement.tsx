'use client'

import { useState, useEffect } from 'react'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Modal from '@/components/ui/Modal'
import Checkbox from '@/components/ui/Checkbox'
import { 
  Package, 
  Plus, 
  Edit2, 
  Trash2, 
  X, 
  Check,
  AlertCircle,
  RefreshCw,
  Eye,
  EyeOff
} from 'lucide-react'
import toast from 'react-hot-toast'

interface CatalogItem {
  id: string
  name: string
  category: string
  volume: number
  weight: number
  is_fragile: boolean
  is_heavy: boolean
  is_glass: boolean
  image: string
  is_active: boolean
  display_order: number
  created_at: string
  updated_at: string
}

const CATEGORIES = ['Sala', 'Comedor', 'Dormitorio', 'Electrodomésticos', 'Oficina', 'Otros']

/** `canAdjust` = puede editar, desactivar y borrar. Sin eso solo agrega ítems nuevos. */
export default function ItemsManagement({ canAdjust = true }: { canAdjust?: boolean }) {
  const [items, setItems] = useState<CatalogItem[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [editingItem, setEditingItem] = useState<CatalogItem | null>(null)
  const [selectedCategory, setSelectedCategory] = useState<string>('Todos')
  const [selectedStatus, setSelectedStatus] = useState<string>('Todos')
  const [searchTerm, setSearchTerm] = useState('')

  const [formData, setFormData] = useState({
    name: '',
    category: 'Sala',
    volume: 0,
    weight: 0,
    isFragile: false,
    isHeavy: false,
    isGlass: false,
    image: '',
    displayOrder: 0
  })

  useEffect(() => {
    fetchItems()
  }, [])

  const fetchItems = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/admin/catalog-items')
      const data = await response.json()
      
      if (response.ok) {
        setItems(data)
      } else {
        toast.error(data.error || 'Error al cargar items')
      }
    } catch (error) {
      console.error('Error fetching items:', error)
      toast.error('Error al cargar items')
    } finally {
      setLoading(false)
    }
  }

  const handleOpenModal = (item?: CatalogItem) => {
    if (item) {
      setEditingItem(item)
      setFormData({
        name: item.name,
        category: item.category,
        volume: item.volume,
        weight: item.weight,
        isFragile: item.is_fragile,
        isHeavy: item.is_heavy,
        isGlass: item.is_glass,
        image: item.image,
        displayOrder: item.display_order
      })
    } else {
      setEditingItem(null)
      setFormData({
        name: '',
        category: 'Sala',
        volume: 0,
        weight: 0,
        isFragile: false,
        isHeavy: false,
        isGlass: false,
        image: '',
        displayOrder: 0
      })
    }
    setShowModal(true)
  }

  const handleCloseModal = () => {
    setShowModal(false)
    setEditingItem(null)
  }

  const handleSave = async () => {
    // Prevenir múltiples peticiones
    if (saving) return
    
    // Validación
    if (!formData.name || formData.volume <= 0 || formData.weight <= 0) {
      toast.error('Completa todos los campos requeridos')
      return
    }

    try {
      setSaving(true)
      
      const url = '/api/admin/catalog-items'
      const method = editingItem ? 'PUT' : 'POST'
      
      const payload = editingItem
        ? { id: editingItem.id, ...formData }
        : formData

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      const data = await response.json()

      if (response.ok) {
        toast.success(editingItem ? 'Item actualizado exitosamente' : 'Item creado exitosamente')
        await fetchItems()
        handleCloseModal()
      } else {
        toast.error(data.error || 'Error al guardar item')
      }
    } catch (error) {
      console.error('Error saving item:', error)
      toast.error('Error al guardar item')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('¿Estás seguro de que quieres eliminar este item?')) {
      return
    }

    try {
      const response = await fetch(`/api/admin/catalog-items?id=${id}`, {
        method: 'DELETE'
      })

      const data = await response.json()

      if (response.ok) {
        toast.success('Item eliminado exitosamente')
        await fetchItems()
      } else {
        toast.error(data.error || 'Error al eliminar item')
      }
    } catch (error) {
      console.error('Error deleting item:', error)
      toast.error('Error al eliminar item')
    }
  }

  const toggleActive = async (item: CatalogItem) => {
    try {
      const newActiveState = !item.is_active
      
      const response = await fetch('/api/admin/catalog-items', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: item.id,
          isActive: newActiveState
        })
      })

      if (response.ok) {
        toast.success(`Item ${newActiveState ? 'activado' : 'desactivado'} exitosamente`)
        await fetchItems()
      } else {
        const data = await response.json()
        toast.error(data.error || 'Error al actualizar estado')
      }
    } catch (error) {
      console.error('Error toggling active:', error)
      toast.error('Error al actualizar estado')
    }
  }

  const filteredItems = items.filter(item => {
    const matchesCategory = selectedCategory === 'Todos' || item.category === selectedCategory
    const matchesSearch = item.name.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesStatus = 
      selectedStatus === 'Todos' || 
      (selectedStatus === 'Activos' && item.is_active) ||
      (selectedStatus === 'Inactivos' && !item.is_active)
    return matchesCategory && matchesSearch && matchesStatus
  })

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Cargando items...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Gestión de Inventario</h2>
          <p className="text-gray-600">Administra los items disponibles para cotizar</p>
        </div>
        <Button onClick={() => handleOpenModal()}>
          <Plus className="w-4 h-4 mr-2" />
          Nuevo Item
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card 
          className={`p-4 cursor-pointer transition-all ${selectedStatus === 'Todos' ? 'ring-2 ring-primary-600' : ''}`}
          onClick={() => setSelectedStatus('Todos')}
        >
          <div className="text-sm text-gray-600">Total Items</div>
          <div className="text-2xl font-bold text-gray-900">{items.length}</div>
        </Card>
        <Card 
          className={`p-4 cursor-pointer transition-all ${selectedStatus === 'Activos' ? 'ring-2 ring-primary-600' : ''}`}
          onClick={() => setSelectedStatus('Activos')}
        >
          <div className="text-sm text-gray-600">Items Activos</div>
          <div className="text-2xl font-bold text-green-600">
            {items.filter(i => i.is_active).length}
          </div>
        </Card>
        <Card 
          className={`p-4 cursor-pointer transition-all ${selectedStatus === 'Inactivos' ? 'ring-2 ring-primary-600' : ''}`}
          onClick={() => setSelectedStatus('Inactivos')}
        >
          <div className="text-sm text-gray-600">Items Inactivos</div>
          <div className="text-2xl font-bold text-red-600">
            {items.filter(i => !i.is_active).length}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-sm text-gray-600">Categorías</div>
          <div className="text-2xl font-bold text-blue-600">
            {new Set(items.map(i => i.category)).size}
          </div>
        </Card>
      </div>

      {/* Filters */}
      <Card className="p-4">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1">
            <input
              type="text"
              placeholder="Buscar items..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div className="flex gap-2 flex-wrap">
            {['Todos', ...CATEGORIES].map(category => (
              <button
                key={category}
                onClick={() => setSelectedCategory(category)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  selectedCategory === category
                    ? 'bg-primary-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {category}
              </button>
            ))}
          </div>
        </div>
      </Card>

      {/* Items Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredItems.map((item) => (
          <Card 
            key={item.id} 
            className={`p-4 ${!item.is_active ? 'opacity-50' : ''}`}
          >
            <div className="flex items-start justify-between mb-3">
              <div>
                <h3 className="font-semibold text-gray-900 text-lg">{item.name}</h3>
                <p className="text-sm text-gray-500">{item.category}</p>
              </div>
              {canAdjust && <button
                onClick={() => toggleActive(item)}
                className={`p-2 rounded-lg transition-colors ${
                  item.is_active 
                    ? 'hover:bg-red-50 text-green-600' 
                    : 'hover:bg-green-50 text-gray-400'
                }`}
                title={item.is_active ? 'Desactivar' : 'Activar'}
              >
                {item.is_active ? <Eye className="w-5 h-5" /> : <EyeOff className="w-5 h-5" />}
              </button>}
            </div>

            <div className="grid grid-cols-2 gap-2 mb-3 text-sm">
              <div>
                <span className="text-gray-600">Volumen:</span>
                <span className="font-semibold ml-1">{item.volume} m³</span>
              </div>
              <div>
                <span className="text-gray-600">Peso:</span>
                <span className="font-semibold ml-1">{item.weight} kg</span>
              </div>
            </div>

            <div className="flex gap-1 mb-3 min-h-[32px] items-center">
              {item.is_fragile ? (
                <span className="px-2 py-1 bg-red-100 text-red-700 text-xs rounded">🔴 Frágil</span>
              ) : null}
              {item.is_heavy ? (
                <span className="px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded">💪 Pesado</span>
              ) : null}
              {item.is_glass ? (
                <span className="px-2 py-1 bg-yellow-100 text-yellow-700 text-xs rounded">🪟 Vidrio</span>
              ) : null}
            </div>

            {canAdjust && <div className="flex gap-2 pt-3 border-t">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleOpenModal(item)}
                className="flex-1"
              >
                <Edit2 className="w-4 h-4 mr-2" />
                Editar
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleDelete(item.id)}
                className="text-red-600 hover:text-red-700 border-red-200 hover:border-red-300"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>}
          </Card>
        ))}
      </div>

      {filteredItems.length === 0 && (
        <Card className="p-12 text-center">
          <Package className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <p className="text-gray-600 mb-4">
            {searchTerm || selectedCategory !== 'Todos' 
              ? 'No se encontraron items con los filtros aplicados'
              : 'No hay items en el catálogo'}
          </p>
          {!searchTerm && selectedCategory === 'Todos' && (
            <Button onClick={() => handleOpenModal()}>
              <Plus className="w-4 h-4 mr-2" />
              Agregar Primer Item
            </Button>
          )}
        </Card>
      )}

      {/* Modal de Edición/Creación */}
      <Modal
        isOpen={showModal}
        onClose={handleCloseModal}
        title={editingItem ? 'Editar Item' : 'Nuevo Item'}
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Nombre del Item
            </label>
            <Input
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="Ej: Sofá 3 cuerpos"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Categoría
            </label>
            <select
              value={formData.category}
              onChange={(e) => setFormData({ ...formData, category: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              {CATEGORIES.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Volumen (m³)
              </label>
              <Input
                type="number"
                step="0.01"
                value={formData.volume || ''}
                onChange={(e) => setFormData({ ...formData, volume: parseFloat(e.target.value) || 0 })}
                placeholder="2.5"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Peso (kg)
              </label>
              <Input
                type="number"
                step="0.1"
                value={formData.weight || ''}
                onChange={(e) => setFormData({ ...formData, weight: parseFloat(e.target.value) || 0 })}
                placeholder="80"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-3">
              Características
            </label>
            <div className="space-y-2">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={formData.isFragile}
                  onChange={(e) => setFormData({ ...formData, isFragile: e.target.checked })}
                  className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                />
                <span className="text-sm">🔴 Frágil (requiere manejo especial)</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={formData.isHeavy}
                  onChange={(e) => setFormData({ ...formData, isHeavy: e.target.checked })}
                  className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                />
                <span className="text-sm">💪 Pesado (requiere equipo adicional)</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={formData.isGlass}
                  onChange={(e) => setFormData({ ...formData, isGlass: e.target.checked })}
                  className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                />
                <span className="text-sm">🪟 Vidrio (requiere embalaje especial)</span>
              </label>
            </div>
          </div>

          <div className="flex gap-3 pt-4">
            <Button
              variant="outline"
              onClick={handleCloseModal}
              className="flex-1"
              disabled={saving}
            >
              <X className="w-4 h-4 mr-2" />
              Cancelar
            </Button>
            <Button
              onClick={handleSave}
              className="flex-1"
              disabled={saving}
            >
              <Check className="w-4 h-4 mr-2" />
              {saving ? (editingItem ? 'Actualizando...' : 'Creando...') : (editingItem ? 'Actualizar' : 'Crear')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

