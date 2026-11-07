'use client'

import { useState, useEffect, useMemo } from 'react'
import { useQuoteStore } from '@/store/quoteStore'
import { getPackagingOptions, PackagingOption } from '@/lib/packagingService'
import Button from '../ui/Button'
import Card from '../ui/Card'
import Modal from '../ui/Modal'
import Input from '../ui/Input'
import { Search, Plus, Minus, Trash2, Package, AlertCircle, Box, Info, CheckCircle2, Sparkles, ClipboardList, HelpCircle, XCircle } from 'lucide-react'
import toast from 'react-hot-toast'
import { generateId } from '@/lib/utils'
import { FULL_MOVE_ITEM_THRESHOLD, totalUnits } from '@/lib/crewPricing'
import { buildCatalogIndex, matchItemList, type LineMatch } from '@/lib/itemListMatcher'

interface CatalogItem {
  id: string
  name: string
  category: string
  volume: number
  weight: number
  isFragile: boolean
  isHeavy: boolean
  isGlass: boolean
  image: string
}

const CATEGORIES = ['Todos', 'Sala', 'Comedor', 'Dormitorio', 'Electrodomésticos', 'Oficina', 'Otros']

const LIST_EXAMPLE = `2 camas de 2 plazas
refri, lavadora y microondas
6 sillas de comedor
sofá 3 cuerpos
tele 55"
10 cajas medianas`

/** Qué se hace con cada línea del listado: el id del item elegido, o `skip`. */
type LineChoice = string | 'skip' | undefined

interface ItemsSelectionStepProps {
  onNext: () => void
  onPrevious: () => void
}

export default function ItemsSelectionStep({ onNext, onPrevious }: ItemsSelectionStepProps) {
  const { items, addItem, updateItem, removeItem, calculateTotals, totalVolume } =
    useQuoteStore()

  const [itemsCatalog, setItemsCatalog] = useState<CatalogItem[]>([])
  const [loadingCatalog, setLoadingCatalog] = useState(true)
  const [selectedCategory, setSelectedCategory] = useState('Todos')
  const [searchTerm, setSearchTerm] = useState('')
  // Dos formas de cargar: pegar un listado escrito o buscar item por item (la de siempre).
  const [loadMode, setLoadMode] = useState<'list' | 'search'>('search')
  const [pastedList, setPastedList] = useState('')
  const [listResults, setListResults] = useState<LineMatch<CatalogItem>[] | null>(null)
  const [lineChoices, setLineChoices] = useState<LineChoice[]>([])
  const [showCustomModal, setShowCustomModal] = useState(false)
  const [showPackagingModal, setShowPackagingModal] = useState(false)
  const [showBulkPackagingModal, setShowBulkPackagingModal] = useState(false)
  // Aviso de mudanza completa: se muestra UNA vez al cruzar el umbral de bultos, no en
  // cada click, para que no se vuelva un modal que el cliente aprende a cerrar sin leer.
  const [showFullMoveModal, setShowFullMoveModal] = useState(false)
  const [fullMoveNotified, setFullMoveNotified] = useState(false)

  const [selectedItemForPackaging, setSelectedItemForPackaging] = useState<string | null>(null)
  const [selectedPackaging, setSelectedPackaging] = useState<string>('none')
  const [packagingTypes, setPackagingTypes] = useState<PackagingOption[]>([])
  const [loadingPackaging, setLoadingPackaging] = useState(true)
  const [customItem, setCustomItem] = useState({
    name: '',
    height: 0,
    width: 0,
    depth: 0,
    weight: 0,
    quantity: 1,
  })

  useEffect(() => {
    calculateTotals()
  }, [items, calculateTotals])

  // Cargar catálogo desde Supabase
  useEffect(() => {
    const loadCatalog = async () => {
      try {
        setLoadingCatalog(true)
        const response = await fetch('/api/admin/catalog-items')
        const data = await response.json()

        if (response.ok && Array.isArray(data)) {
          // Transformar datos de Supabase al formato esperado
          // FILTRAR: Solo mostrar items activos en el cotizador
          const catalogItems = data
            .filter((item: any) => item.is_active) // Solo items activos
            .map((item: any) => ({
              id: item.id,
              name: item.name,
              category: item.category,
              volume: item.volume,
              weight: item.weight,
              isFragile: item.is_fragile,
              isHeavy: item.is_heavy,
              isGlass: item.is_glass,
              image: item.image
            }))
          setItemsCatalog(catalogItems)
        } else {
          console.error('Error loading catalog:', data)
          toast.error('Error al cargar catálogo de items')
        }
      } catch (error) {
        console.error('Error fetching catalog:', error)
        toast.error('Error al cargar catálogo de items')
      } finally {
        setLoadingCatalog(false)
      }
    }

    loadCatalog()
  }, [])

  // Cargar opciones de embalaje dinámicamente
  useEffect(() => {
    const loadPackagingOptions = async () => {
      try {
        setLoadingPackaging(true)
        const options = await getPackagingOptions()
        setPackagingTypes(options)
      } catch (error) {
        console.error('Error loading packaging options:', error)
        toast.error('Error al cargar opciones de embalaje')
      } finally {
        setLoadingPackaging(false)
      }
    }

    loadPackagingOptions()
  }, [])

  // Cantidad real de bultos (suma de cantidades, no de líneas del catálogo).
  const unitCount = totalUnits(items)

  // El aviso de mudanza completa se dispara UNA vez al cruzar el umbral, no en cada
  // click, para que no se vuelva un modal que el cliente aprende a cerrar sin leer.
  useEffect(() => {
    if (unitCount > FULL_MOVE_ITEM_THRESHOLD && !fullMoveNotified) {
      setShowFullMoveModal(true)
      setFullMoveNotified(true)
    }
  }, [unitCount, fullMoveNotified])

  // El índice se arma una vez por catálogo, no en cada tecla.
  const catalogIndex = useMemo(() => buildCatalogIndex(itemsCatalog), [itemsCatalog])

  const filteredItems = itemsCatalog.filter((item) => {
    const matchesCategory = selectedCategory === 'Todos' || item.category === selectedCategory
    const matchesSearch = item.name.toLowerCase().includes(searchTerm.toLowerCase())
    return matchesCategory && matchesSearch
  })

  if (loadingCatalog) {
    return (
      <div className="max-w-7xl mx-auto animate-slide-up">
        <div className="flex items-center justify-center py-24">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto mb-4"></div>
            <p className="text-gray-600">Cargando catálogo de items...</p>
          </div>
        </div>
      </div>
    )
  }

  const getItemQuantity = (itemId: string) => {
    const item = items.find((i) => i.id === itemId)
    return item?.quantity || 0
  }

  const handleAddItem = (catalogItem: typeof itemsCatalog[0]) => {
    const existingItem = items.find((i) => i.id === catalogItem.id)

    if (existingItem) {
      updateItem(existingItem.id, { quantity: existingItem.quantity + 1 })
    } else {
      addItem({
        ...catalogItem,
        quantity: 1,
      })
    }
  }

  const handleDecreaseItem = (itemId: string) => {
    const item = items.find((i) => i.id === itemId)
    if (item) {
      if (item.quantity > 1) {
        updateItem(itemId, { quantity: item.quantity - 1 })
      } else {
        removeItem(itemId)
      }
    }
  }

  const handleRecognizeList = () => {
    const results = matchItemList(pastedList, catalogIndex)
    if (results.length === 0) {
      toast.error('No encontramos cosas en el texto. Escribe una por línea o separadas por coma.')
      return
    }
    setListResults(results)
    // Lo reconocido sin duda viene elegido; lo dudoso queda sin responder; lo que no se
    // encontró, afuera.
    setLineChoices(
      results.map((r) => (r.status === 'match' ? r.item.id : r.status === 'none' ? 'skip' : undefined))
    )
  }

  const setLineChoice = (index: number, choice: LineChoice) => {
    setLineChoices((prev) => prev.map((c, i) => (i === index ? choice : c)))
  }

  const handleAddRecognized = () => {
    if (!listResults) return
    // Se suman por item ANTES de tocar el store: dos líneas que apuntan al mismo item
    // («2 veladores» y «velador») con el `items` de este render crearían dos filas.
    const quantities = new Map<string, number>()
    listResults.forEach((r, i) => {
      const choice = lineChoices[i]
      if (!choice || choice === 'skip') return
      quantities.set(choice, (quantities.get(choice) || 0) + r.line.quantity)
    })
    if (quantities.size === 0) {
      toast.error('No hay nada elegido para agregar')
      return
    }

    let units = 0
    quantities.forEach((quantity, id) => {
      const catalogItem = itemsCatalog.find((c) => c.id === id)
      if (!catalogItem) return
      const existing = items.find((i) => i.id === id)
      if (existing) {
        updateItem(id, { quantity: existing.quantity + quantity })
      } else {
        addItem({ ...catalogItem, quantity })
      }
      units += quantity
    })

    toast.success(`Agregamos ${units} ${units === 1 ? 'artículo' : 'artículos'} a tu lista`)
    setPastedList('')
    setListResults(null)
    setLineChoices([])
  }

  const handleAddCustomItem = () => {
    // Calcular volumen a partir de dimensiones (convertir cm a metros, luego a m³)
    const volumeInM3 = ((customItem.height * customItem.width * customItem.depth) / 1000000).toFixed(4)

    if (
      !customItem.name ||
      customItem.height <= 0 ||
      customItem.width <= 0 ||
      customItem.depth <= 0 ||
      customItem.weight <= 0 ||
      !Number.isInteger(customItem.quantity) ||
      customItem.quantity <= 0
    ) {
      toast.error('Completa todos los campos del item personalizado')
      return
    }

    addItem({
      id: `custom-${generateId()}`,
      name: customItem.name,
      category: 'Personalizado',
      volume: parseFloat(volumeInM3),
      weight: customItem.weight,
      quantity: customItem.quantity,
      isFragile: false,
      isHeavy: customItem.weight > 50,
      isGlass: false,
    })

    setCustomItem({ name: '', height: 0, width: 0, depth: 0, weight: 0, quantity: 1 })
    setShowCustomModal(false)
    toast.success(
      `${customItem.quantity} ${customItem.quantity === 1 ? 'item agregado' : 'items agregados'} - Volumen total: ${(
        Number(volumeInM3) * customItem.quantity
      ).toFixed(4)} m³`
    )
  }

  const handleOpenPackagingModal = (itemId: string) => {
    const item = items.find(i => i.id === itemId)
    if (item) {
      setSelectedItemForPackaging(itemId)
      setSelectedPackaging(item.packaging?.type || 'none')
      setShowPackagingModal(true)
    }
  }

  const handleSavePackaging = () => {
    if (!selectedItemForPackaging) return

    const packagingOption = packagingTypes.find(p => p.id === selectedPackaging)

    if (selectedPackaging === 'none') {
      // Remover embalaje
      updateItem(selectedItemForPackaging, { packaging: undefined })
      toast.success('Embalaje removido')
    } else if (packagingOption) {
      // Agregar/actualizar embalaje
      updateItem(selectedItemForPackaging, {
        packaging: {
          type: selectedPackaging,
          pricePerUnit: packagingOption.price
        }
      })
      toast.success(`Embalaje configurado: ${packagingOption.name}`)
    }

    setShowPackagingModal(false)
    setSelectedItemForPackaging(null)
  }

  const handleBulkPackaging = (packagingId: string) => {
    const packagingOption = packagingTypes.find(p => p.id === packagingId)

    if (packagingId === 'none') {
      // Remover embalaje de todos los items
      items.forEach(item => {
        if (item.packaging) {
          updateItem(item.id, { packaging: undefined })
        }
      })
      toast.success('Se quitó el embalaje de todos los items')
    } else if (packagingOption) {
      // Aplicar embalaje a todos los items
      items.forEach(item => {
        updateItem(item.id, {
          packaging: {
            type: packagingId,
            pricePerUnit: packagingOption.price
          }
        })
      })
      toast.success(`Se aplicó ${packagingOption.name} a todos los items`)
    }

    setShowBulkPackagingModal(false)
  }

  // Calcular total de embalaje (volumen de items con embalaje × precio por m³)
  const packagingTotal = items
    .filter(item => item.packaging && item.packaging.type !== 'none')
    .reduce((sum, item) => {
      const itemVolume = item.volume * item.quantity
      const itemPackagingCost = item.packaging?.pricePerUnit || 0
      return sum + (itemPackagingCost * itemVolume)
    }, 0)

  // Contar items con embalaje
  const itemsWithPackaging = items.filter(item => item.packaging && item.packaging.type !== 'none').length

  const handleNext = () => {
    if (items.length === 0) {
      toast.error('Debes seleccionar al menos un item')
      return
    }
    calculateTotals()
    onNext()
  }

  return (
    <div className="max-w-7xl mx-auto animate-slide-up">
      <div className="mb-6 text-center">
        <h2 className="text-3xl font-bold text-gray-900 mb-2">Selecciona tus Items</h2>
        <p className="text-gray-600">
          Pega tu lista de cosas y la reconocemos, o agrégalas una por una desde el catálogo
        </p>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Panel izquierdo - Catálogo */}
        <div className="lg:col-span-2">
          <Card variant="elevated">
            {/* Cómo cargar: pegar el listado o buscar item por item */}
            <p className="text-sm font-semibold text-gray-800 mb-2">¿Cómo quieres agregar tus cosas?</p>
            <div className="grid grid-cols-2 gap-2 mb-6 p-1 bg-gray-100 rounded-xl" role="tablist">
              {([
                ['list', 'Pega tu listado', ClipboardList],
                ['search', 'Busca ítem por ítem', Search],
              ] as const).map(([mode, label, Icon]) => (
                <button
                  key={mode}
                  type="button"
                  role="tab"
                  aria-selected={loadMode === mode}
                  onClick={() => setLoadMode(mode)}
                  className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-sm font-semibold transition-all ${loadMode === mode
                    ? 'bg-white text-primary-700 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                    }`}
                >
                  <Icon className="w-4 h-4 flex-shrink-0" />
                  {label}
                </button>
              ))}
            </div>

            {loadMode === 'list' ? (
              <div className="mb-2">
                <p className="text-sm text-gray-600 mb-3">
                  Pega tu listado tal como lo tienes, una cosa por línea o separadas por coma.
                  Reconocemos las cantidades y solo te preguntamos lo que no quede claro.
                </p>
                <textarea
                  value={pastedList}
                  onChange={(e) => setPastedList(e.target.value)}
                  placeholder={LIST_EXAMPLE}
                  rows={7}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
                <Button
                  type="button"
                  onClick={handleRecognizeList}
                  disabled={!pastedList.trim()}
                  className="w-full mt-3"
                >
                  <ClipboardList className="w-4 h-4 mr-2" />
                  Reconocer mi listado
                </Button>

                {listResults && (() => {
                  const matched = listResults.filter((r) => r.status === 'match').length
                  const doubts = listResults.filter((r) => r.status === 'doubt').length
                  const missing = listResults.filter((r) => r.status === 'none').length
                  const pending = listResults.filter((r, i) => r.status === 'doubt' && lineChoices[i] === undefined).length
                  const chosen = lineChoices.filter((c) => c && c !== 'skip').length

                  return (
                    <div className="mt-6 space-y-5">
                      <div className="flex flex-wrap gap-2 text-xs font-medium">
                        <span className="px-2 py-1 rounded-full bg-green-100 text-green-800">{matched} reconocidos</span>
                        {doubts > 0 && <span className="px-2 py-1 rounded-full bg-amber-100 text-amber-800">{doubts} con duda</span>}
                        {missing > 0 && <span className="px-2 py-1 rounded-full bg-gray-200 text-gray-700">{missing} sin encontrar</span>}
                      </div>

                      {doubts > 0 && (
                        <div>
                          <h4 className="flex items-center gap-2 text-sm font-bold text-amber-800 mb-2">
                            <HelpCircle className="w-4 h-4" />
                            ¿Cuál de estos es?
                          </h4>
                          <div className="space-y-3">
                            {listResults.map((r, i) => r.status !== 'doubt' ? null : (
                              <div key={i} className="p-3 rounded-lg border border-amber-200 bg-amber-50">
                                <div className="text-sm text-gray-800 mb-2">
                                  <span className="font-semibold">{r.line.quantity}×</span> «{r.line.text}»
                                </div>
                                <div className="flex flex-wrap gap-2">
                                  {r.candidates.map((c) => (
                                    <button
                                      key={c.id}
                                      type="button"
                                      onClick={() => setLineChoice(i, c.id)}
                                      className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${lineChoices[i] === c.id
                                        ? 'bg-primary-600 border-primary-600 text-white'
                                        : 'bg-white border-gray-300 text-gray-700 hover:border-primary-400'
                                        }`}
                                    >
                                      {c.name.trim()}
                                    </button>
                                  ))}
                                  <button
                                    type="button"
                                    onClick={() => setLineChoice(i, 'skip')}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${lineChoices[i] === 'skip'
                                      ? 'bg-gray-700 border-gray-700 text-white'
                                      : 'bg-white border-gray-300 text-gray-500 hover:border-gray-400'
                                      }`}
                                  >
                                    Ninguno
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {matched > 0 && (
                        <div>
                          <h4 className="flex items-center gap-2 text-sm font-bold text-green-800 mb-2">
                            <CheckCircle2 className="w-4 h-4" />
                            Reconocidos
                          </h4>
                          <div className="divide-y divide-gray-100 rounded-lg border border-gray-200">
                            {listResults.map((r, i) => r.status !== 'match' ? null : (
                              <div key={i} className={`flex items-center justify-between gap-3 px-3 py-2 ${lineChoices[i] === 'skip' ? 'opacity-50' : ''}`}>
                                <div className="min-w-0">
                                  <div className="text-sm font-medium text-gray-900">
                                    {r.line.quantity}× {r.item.name.trim()}
                                  </div>
                                  <div className="text-xs text-gray-500 truncate">«{r.line.raw}»</div>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => setLineChoice(i, lineChoices[i] === 'skip' ? r.item.id : 'skip')}
                                  className="text-xs font-medium text-gray-500 hover:text-red-600 flex-shrink-0"
                                >
                                  {lineChoices[i] === 'skip' ? 'Incluir' : 'Quitar'}
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {missing > 0 && (
                        <div>
                          <h4 className="flex items-center gap-2 text-sm font-bold text-gray-700 mb-2">
                            <XCircle className="w-4 h-4" />
                            No lo encontramos en el catálogo
                          </h4>
                          <div className="space-y-2">
                            {listResults.map((r, i) => r.status !== 'none' ? null : (
                              <div key={i} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-lg bg-gray-50 border border-gray-200">
                                <span className="text-sm text-gray-800">
                                  <span className="font-semibold">{r.line.quantity}×</span> «{r.line.text}»
                                </span>
                                <div className="flex gap-3 text-xs font-medium">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setSearchTerm('')
                                      setSelectedCategory('Todos')
                                      setLoadMode('search')
                                    }}
                                    className="text-primary-600 hover:text-primary-700"
                                  >
                                    Buscar en el catálogo
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setCustomItem({ ...customItem, name: r.line.text, quantity: r.line.quantity })
                                      setShowCustomModal(true)
                                    }}
                                    className="text-primary-600 hover:text-primary-700"
                                  >
                                    Agregar como personalizado
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {pending > 0 && (
                        <p className="text-xs text-amber-800">
                          Te {pending === 1 ? 'queda 1 duda' : `quedan ${pending} dudas`} sin responder: si no eliges, esas líneas no se agregan.
                        </p>
                      )}

                      <Button
                        type="button"
                        variant="brand"
                        onClick={handleAddRecognized}
                        disabled={chosen === 0}
                        className="w-full"
                      >
                        <Plus className="w-4 h-4 mr-2" />
                        Agregar a mi lista
                      </Button>
                    </div>
                  )
                })()}
              </div>
            ) : (
            <>
            {/* Buscador y filtros */}
            <div className="mb-6">
              <div className="relative mb-4">
                <Search className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
                <input
                  type="text"
                  placeholder="Buscar items..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>

              <div className="flex flex-wrap gap-2">
                {CATEGORIES.map((category) => (
                  <button
                    key={category}
                    onClick={() => setSelectedCategory(category)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${selectedCategory === category
                      ? 'bg-primary-600 text-white shadow-md'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                  >
                    {category}
                  </button>
                ))}
              </div>
            </div>

            {/* Grid de items */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 max-h-[600px] overflow-y-auto pr-2">
              {filteredItems.map((item) => {
                const quantity = getItemQuantity(item.id)
                return (
                  <div
                    key={item.id}
                    className={`p-4 rounded-lg border-2 transition-all hover:shadow-md ${quantity > 0
                      ? 'border-primary-600 bg-primary-50'
                      : 'border-gray-200 hover:border-primary-300'
                      }`}
                  >
                    <h4 className="text-lg font-semibold text-center mb-2 min-h-[52px] flex items-center justify-center">
                      {item.name}
                    </h4>
                    <div className="text-xs text-gray-500 text-center mb-3">
                      {item.volume}m³ • {item.weight}kg
                    </div>

                    {/* Indicadores */}
                    <div className="flex justify-center gap-1 mb-3 min-h-[20px]">
                      {item.isFragile && <span className="text-xs">🔴</span>}
                      {item.isHeavy && <span className="text-xs">💪</span>}
                      {item.isGlass && <span className="text-xs">🪟</span>}
                    </div>

                    {/* Controles */}
                    {quantity === 0 ? (
                      <Button
                        size="sm"
                        onClick={() => handleAddItem(item)}
                        className="w-full"
                      >
                        <Plus className="w-4 h-4 mr-1" />
                        Agregar
                      </Button>
                    ) : (
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => handleDecreaseItem(item.id)}
                          className="w-8 h-8 rounded-full bg-red-100 text-red-600 hover:bg-red-200 flex items-center justify-center"
                        >
                          <Minus className="w-4 h-4" />
                        </button>
                        <span className="font-bold text-lg w-8 text-center">{quantity}</span>
                        <button
                          onClick={() => handleAddItem(item)}
                          className="w-8 h-8 rounded-full bg-primary-100 text-primary-600 hover:bg-primary-200 flex items-center justify-center"
                        >
                          <Plus className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            </>
            )}

            {/* Botón item personalizado */}
            <div className="mt-4">
              <Button
                variant="outline"
                onClick={() => setShowCustomModal(true)}
                className="w-full"
              >
                <Plus className="w-4 h-4 mr-2" />
                Agregar Item Personalizado
              </Button>
            </div>
          </Card>
        </div>

        {/* Panel derecho - Resumen */}
        <div className="lg:col-span-1">
          <div className="sticky top-24">
            {/* Banner informativo */}
            {/* Banner informativo */}
            {items.length > 0 && (
              <Card className="mb-4 bg-gradient-to-r from-amber-50 to-orange-50 border-amber-200 shadow-sm">
                <div className="flex items-start gap-3">
                  <div className="p-2 bg-amber-100 rounded-full flex-shrink-0">
                    <Sparkles className="w-5 h-5 text-amber-600" />
                  </div>
                  <div className="flex-1 pt-1">
                    <p className="text-sm text-amber-900 mb-0 leading-relaxed">
                      <span className="font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded text-xs mr-2 uppercase tracking-wide">Importante</span>
                      Configura el embalaje especial para cada item usando el botón 📦
                    </p>
                  </div>
                </div>
              </Card>
            )}

            {/* Opciones Globales */}
            {items.length > 0 && (
              <Card variant="elevated" className="mb-4 border-l-4 border-l-primary-500">
                <h3 className="text-lg font-bold mb-3 flex items-center gap-2">
                  Acciones Rápidas
                </h3>
                <div className="space-y-2">
                  <Button
                    variant="outline"
                    onClick={() => setShowBulkPackagingModal(true)}
                    className="w-full justify-start text-left h-auto py-3"
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-primary-50 rounded-lg text-primary-600">
                        <Box className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="font-semibold text-gray-900">Embalar Todo</div>
                        <div className="text-xs text-gray-500">Aplica el mismo embalaje a todos los items</div>
                      </div>
                    </div>
                  </Button>

                  {itemsWithPackaging > 0 && (
                    <button
                      onClick={() => handleBulkPackaging('none')}
                      className="w-full flex items-center justify-center gap-2 text-sm text-red-600 hover:text-red-700 hover:bg-red-50 p-2 rounded-lg transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                      Quitar todo el embalaje
                    </button>
                  )}
                </div>
              </Card>
            )}

            <Card variant="elevated" className="mb-4">
              {/* ... existing summary ... */}

              <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                <Package className="w-5 h-5" />
                Resumen de Items
              </h3>

              {items.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <AlertCircle className="w-12 h-12 mx-auto mb-2 opacity-50" />
                  <p>No has seleccionado items</p>
                </div>
              ) : (
                <>
                  <div className="max-h-64 overflow-y-auto mb-4 space-y-2">
                    {items.map((item) => {
                      const hasPackaging = item.packaging && item.packaging.type !== 'none'
                      const packagingInfo = hasPackaging
                        ? packagingTypes.find(p => p.id === item.packaging?.type)
                        : null

                      return (
                        <div
                          key={item.id}
                          className="p-2 bg-gray-50 rounded-lg"
                        >
                          <div className="flex items-center justify-between mb-1 gap-2">
                            <div className="flex-1">
                              <div className="font-medium text-sm">{item.name}</div>
                              <div className="mt-1 flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => handleDecreaseItem(item.id)}
                                  className="flex h-6 w-6 items-center justify-center rounded-full bg-red-100 text-red-600 hover:bg-red-200"
                                  aria-label={`Quitar una unidad de ${item.name}`}
                                >
                                  <Minus className="h-3 w-3" />
                                </button>
                                <span className="min-w-5 text-center text-xs font-semibold text-gray-700">
                                  {item.quantity}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => updateItem(item.id, { quantity: item.quantity + 1 })}
                                  className="flex h-6 w-6 items-center justify-center rounded-full bg-primary-100 text-primary-600 hover:bg-primary-200"
                                  aria-label={`Agregar una unidad de ${item.name}`}
                                >
                                  <Plus className="h-3 w-3" />
                                </button>
                              </div>
                            </div>
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => handleOpenPackagingModal(item.id)}
                                className={`p-1.5 rounded-lg transition-all relative group ${hasPackaging
                                  ? 'bg-green-100 text-green-600 hover:bg-green-200'
                                  : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
                                  }`}
                                title="Configurar embalaje"
                              >
                                <Box className="w-4 h-4" />
                                {hasPackaging && (
                                  <CheckCircle2 className="w-3 h-3 absolute -top-1 -right-1 text-green-600 bg-white rounded-full" />
                                )}
                              </button>
                              <button
                                onClick={() => removeItem(item.id)}
                                className="text-red-500 hover:text-red-700 p-1"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                          {hasPackaging && packagingInfo && (
                            <div className="text-xs text-green-700 bg-green-50 px-2 py-1 rounded">
                              {packagingInfo.icon} {packagingInfo.name} - ${packagingInfo.price.toLocaleString()} por m³
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>

                  <div className="border-t pt-4 space-y-2">
                    <div className="flex justify-between text-sm">
                      <span>Total Items:</span>
                      <span className="font-bold">
                        {items.reduce((sum, item) => sum + item.quantity, 0)}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span>Volumen Total:</span>
                      <span className="font-bold">{parseFloat(totalVolume.toFixed(2))} m³</span>
                    </div>
                    {itemsWithPackaging > 0 && (
                      <>
                        <div className="flex justify-between text-sm text-green-700">
                          <span>📦 Items con embalaje:</span>
                          <span className="font-bold">{itemsWithPackaging}</span>
                        </div>
                        <div className="flex justify-between text-sm text-green-700">
                          <span>Total embalaje:</span>
                          <span className="font-bold">${packagingTotal.toLocaleString()}</span>
                        </div>
                      </>
                    )}
                  </div>
                </>
              )}
            </Card>

            {/* Leyenda */}
            <Card className="bg-blue-50 border-blue-200">
              <h4 className="font-semibold mb-2 text-sm">Leyenda:</h4>
              <div className="space-y-1 text-xs">
                <div>🔴 Frágil</div>
                <div>💪 Pesado</div>
                <div>🪟 Vidrio</div>
              </div>
            </Card>
          </div>
        </div>
      </div>

      {/* Modal Embalaje Masivo */}
      <Modal
        isOpen={showBulkPackagingModal}
        onClose={() => {
          setShowBulkPackagingModal(false)
          setSelectedPackaging('none')
        }}
        title="Embalaje Masivo"
      >
        <div className="space-y-4">
          <div className="bg-gray-50 p-3 rounded-lg">
            <div className="text-sm text-gray-600 mb-1">Aplicar a todos los items:</div>
            <div className="font-semibold">
              {items.length} items en total
            </div>
            <div className="text-xs text-blue-700 mt-2 bg-blue-50 px-2 py-1 rounded">
              💡 Esto aplicará el embalaje seleccionado a TODOS los items de tu lista
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-3">
              Selecciona el tipo de embalaje:
            </label>
            <div className="space-y-2">
              {packagingTypes.map((type) => {
                const totalCost = type.price * totalVolume

                return (
                  <button
                    key={type.id}
                    onClick={() => setSelectedPackaging(type.id)}
                    className={`w-full p-4 rounded-lg border-2 text-left transition-all ${selectedPackaging === type.id
                      ? 'border-primary-600 bg-primary-50'
                      : 'border-gray-200 hover:border-primary-300'
                      }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="text-2xl">{type.icon}</div>
                      <div className="flex-1">
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-semibold">{type.name}</span>
                          {type.price > 0 && (
                            <span className="text-primary-600 font-bold">
                              ${type.price.toLocaleString()} por m³
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-gray-600">{type.description}</p>
                        {type.price > 0 && totalVolume > 0 && (
                          <p className="text-xs text-gray-500 mt-1">
                            Costo total estimado: ${totalCost.toLocaleString()}
                          </p>
                        )}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="flex gap-3 pt-4">
            <Button
              variant="outline"
              onClick={() => {
                setShowBulkPackagingModal(false)
                setSelectedPackaging('none')
              }}
              className="flex-1"
            >
              Cancelar
            </Button>
            <Button onClick={() => handleBulkPackaging(selectedPackaging)} className="flex-1">
              Aplicar a Todo
            </Button>
          </div>
        </div>
      </Modal>

      {/* Modal Item Personalizado */}
      <Modal
        isOpen={showCustomModal}
        onClose={() => setShowCustomModal(false)}
        title="Agregar Item Personalizado"
      >
        <div className="space-y-4">
          <Input
            label="Nombre del Item"
            placeholder="Ej: Piano de cola"
            value={customItem.name}
            onChange={(e) => setCustomItem({ ...customItem, name: e.target.value })}
          />

          <div className="grid grid-cols-3 gap-3">
            <Input
              label="Altura (cm)"
              type="number"
              step="0.1"
              placeholder="150"
              value={customItem.height || ''}
              onChange={(e) =>
                setCustomItem({ ...customItem, height: parseFloat(e.target.value) || 0 })
              }
            />
            <Input
              label="Ancho (cm)"
              type="number"
              step="0.1"
              placeholder="100"
              value={customItem.width || ''}
              onChange={(e) =>
                setCustomItem({ ...customItem, width: parseFloat(e.target.value) || 0 })
              }
            />
            <Input
              label="Profundidad (cm)"
              type="number"
              step="0.1"
              placeholder="80"
              value={customItem.depth || ''}
              onChange={(e) =>
                setCustomItem({ ...customItem, depth: parseFloat(e.target.value) || 0 })
              }
            />
          </div>

          {/* Mostrar volumen calculado */}
          {(customItem.height > 0 && customItem.width > 0 && customItem.depth > 0) && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-blue-800 font-semibold">📐 Volumen calculado:</span>
                <span className="text-blue-900 font-bold">
                  {((customItem.height * customItem.width * customItem.depth) / 1000000).toFixed(4)} m³
                </span>
              </div>
              <p className="text-xs text-blue-700 mt-1">
                {customItem.height} cm × {customItem.width} cm × {customItem.depth} cm
              </p>
            </div>
          )}

          <Input
            label="Peso estimado (kg)"
            type="number"
            placeholder="50"
            value={customItem.weight || ''}
            onChange={(e) =>
              setCustomItem({ ...customItem, weight: parseFloat(e.target.value) || 0 })
            }
          />

          <Input
            label="Cantidad"
            type="number"
            min="1"
            step="1"
            placeholder="1"
            value={customItem.quantity}
            onChange={(e) =>
              setCustomItem({
                ...customItem,
                quantity: Math.max(1, Math.trunc(Number(e.target.value) || 1)),
              })
            }
          />

          {customItem.quantity > 1 && customItem.height > 0 && customItem.width > 0 && customItem.depth > 0 && (
            <p className="text-sm text-gray-600">
              Volumen total para {customItem.quantity} unidades:{' '}
              <strong>
                {(
                  (customItem.height * customItem.width * customItem.depth * customItem.quantity) /
                  1000000
                ).toFixed(4)}{' '}
                m³
              </strong>
            </p>
          )}

          <div className="flex gap-3 pt-4">
            <Button variant="outline" onClick={() => setShowCustomModal(false)} className="flex-1">
              Cancelar
            </Button>
            <Button onClick={handleAddCustomItem} className="flex-1">
              Agregar
            </Button>
          </div>
        </div>
      </Modal>

      {/* Modal Configurar Embalaje */}
      <Modal
        isOpen={showPackagingModal}
        onClose={() => {
          setShowPackagingModal(false)
          setSelectedItemForPackaging(null)
        }}
        title="Configurar Embalaje"
      >
        <div className="space-y-4">
          {selectedItemForPackaging && (
            <>
              <div className="bg-gray-50 p-3 rounded-lg">
                <div className="text-sm text-gray-600 mb-1">Item seleccionado:</div>
                <div className="font-semibold">
                  {items.find(i => i.id === selectedItemForPackaging)?.name}
                </div>
                <div className="text-sm text-gray-600 mt-1">
                  Cantidad: {items.find(i => i.id === selectedItemForPackaging)?.quantity} unidad(es)
                </div>
                <div className="text-xs text-blue-700 mt-2 bg-blue-50 px-2 py-1 rounded">
                  💡 El embalaje especial se aplica a todos los m³ de tu mudanza
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-3">
                  Selecciona el tipo de embalaje:
                </label>
                <div className="space-y-2">
                  {packagingTypes.map((type) => {
                    const item = items.find(i => i.id === selectedItemForPackaging)
                    const totalPrice = type.price * totalVolume // Precio por m³ × m³ totales

                    return (
                      <button
                        key={type.id}
                        onClick={() => setSelectedPackaging(type.id)}
                        className={`w-full p-4 rounded-lg border-2 text-left transition-all ${selectedPackaging === type.id
                          ? 'border-primary-600 bg-primary-50'
                          : 'border-gray-200 hover:border-primary-300'
                          }`}
                      >
                        <div className="flex items-start gap-3">
                          <div className="text-2xl">{type.icon}</div>
                          <div className="flex-1">
                            <div className="flex items-center justify-between mb-1">
                              <span className="font-semibold">{type.name}</span>
                              {type.price > 0 && (
                                <span className="text-primary-600 font-bold">
                                  ${type.price.toLocaleString()} por m³
                                </span>
                              )}
                            </div>
                            <p className="text-sm text-gray-600">{type.description}</p>
                            {type.price > 0 && totalVolume > 0 && (
                              <p className="text-xs text-gray-500 mt-1">
                                Total: ${totalPrice.toLocaleString()} ({parseFloat(totalVolume.toFixed(1))} m³)
                              </p>
                            )}
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                <p className="text-xs text-blue-800">
                  <strong>💡 Tip:</strong> El embalaje especial se cobra multiplicando el precio por los m³ totales de tu mudanza.
                  Si seleccionas varios tipos de embalaje, cada uno se suma al costo final.
                </p>
              </div>

              <div className="flex gap-3 pt-4">
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowPackagingModal(false)
                    setSelectedItemForPackaging(null)
                  }}
                  className="flex-1"
                >
                  Cancelar
                </Button>
                <Button onClick={handleSavePackaging} className="flex-1">
                  Guardar
                </Button>
              </div>
            </>
          )}
        </div>
      </Modal>

      {/* Aviso de mudanza completa. El objetivo es que TERMINE de cotizar sabiendo que
          el precio es estimado; el contacto lo iniciamos nosotros después. Por eso no
          hay salida al formulario de contacto acá: mandarlo a escribirnos en este punto
          corta la cotización justo cuando ya cargó todo. */}
      <Modal
        isOpen={showFullMoveModal}
        onClose={() => setShowFullMoveModal(false)}
        title="Con esta cantidad, el precio es estimado"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-700">
            Llevas <strong>{unitCount} artículos</strong>. Por sobre{' '}
            {FULL_MOVE_ITEM_THRESHOLD} bultos ya es una mudanza completa: el camión, la
            cantidad de gente y el tiempo que toma dependen de detalles que la lista sola
            no alcanza a reflejar.
          </p>

          <div className="rounded-lg bg-blue-50 border border-blue-200 p-4 text-sm text-blue-900">
            <p className="font-semibold mb-1">Sigue cotizando con tranquilidad</p>
            <p>
              Al terminar te mostramos el precio estimado con todo lo que cargaste, y
              después te contactamos nosotros para afinar los detalles y dejarlo
              confirmado. No tienes que hacer nada más ahora.
            </p>
          </div>

          <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800">
            En mudanzas completas trabajamos hasta un <strong>5º piso sin ascensor</strong>.
            Si tu edificio supera eso, lo revisamos contigo cuando te contactemos.
          </div>

          <Button
            onClick={() => setShowFullMoveModal(false)}
            variant="brand"
            className="w-full"
          >
            Entendido, seguir cotizando
          </Button>
        </div>
      </Modal>

      {/* Botones */}
      <div className="flex gap-4 mt-6">
        <Button type="button" onClick={onPrevious} variant="outline" className="flex-1">
          ← Volver
        </Button>
        <Button onClick={handleNext} variant="brand" className="flex-1">
          Continuar →
        </Button>
      </div>
    </div>
  )
}
