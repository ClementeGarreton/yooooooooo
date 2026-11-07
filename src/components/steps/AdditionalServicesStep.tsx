'use client'

import { toHiddenFileUrl } from '@/lib/fileLinks'
import { useState, useEffect } from 'react'
import { useQuoteStore } from '@/store/quoteStore'
import { getAdditionalServices, AdditionalService } from '@/lib/additionalServicesService'
import Button from '../ui/Button'
import Checkbox from '../ui/Checkbox'
import Card from '../ui/Card'
import { Wrench, Package, Camera, FileText, Users, Minus, Plus } from 'lucide-react'
import toast from 'react-hot-toast'
import { getPricingConfig } from '@/lib/pricingService'
import { DEFAULT_CREW, requiredPeople, type CrewConfig } from '@/lib/crewPricing'
import { hasFridge } from '@/lib/extraServices'

interface AdditionalServicesStepProps {
  onNext: () => void
  onPrevious: () => void
}

export default function AdditionalServicesStep({ onNext, onPrevious }: AdditionalServicesStepProps) {
  const { additionalServices, setAdditionalServices, calculateTotals, items } = useQuoteStore()

  const [services, setServices] = useState<AdditionalService[]>([])
  const [loadingServices, setLoadingServices] = useState(true)
  const [isUploadingPhotos, setIsUploadingPhotos] = useState(false)
  const [crewConfig, setCrewConfig] = useState<CrewConfig>(DEFAULT_CREW)
  const [formData, setFormData] = useState({
    disassembly: additionalServices.disassembly,
    assembly: additionalServices.assembly,
    packing: additionalServices.packing,
    unpacking: additionalServices.unpacking,
    observations: additionalServices.observations,
    photos: additionalServices.photos,
    extraHelpers: additionalServices.extraHelpers || 0,
    // `?? false`: una cotización a medio hacer, guardada en localStorage antes de que
    // existieran estos dos campos, los trae como undefined y dejaría el checkbox sin
    // controlar.
    fridgeDisassembly: additionalServices.fridgeDisassembly ?? false,
    priority: additionalServices.priority ?? false,
    stairsCarry: additionalServices.stairsCarry ?? false,
  })

  // ¿Hay un refrigerador en la lista? De esto depende que el servicio se ofrezca.
  const fridgePresent = hasFridge(items)

  // Cuadrilla mínima que exige el bulto más pesado. Los ayudantes que elija el cliente
  // van POR ENCIMA de esto, nunca lo reemplazan.
  const crewByWeight = requiredPeople(items, crewConfig)
  const maxExtraHelpers = Math.max(0, crewConfig.maxPeople - crewByWeight)
  const helpersCost =
    Math.max(0, crewByWeight + formData.extraHelpers - crewConfig.includedPeople) *
    crewConfig.pricePerExtraPerson

  useEffect(() => {
    getPricingConfig()
      .then((config) => setCrewConfig(config.crew || DEFAULT_CREW))
      .catch(() => setCrewConfig(DEFAULT_CREW))
  }, [])

  // Si baja el peso de la carga, el tope de ayudantes baja con él: hay que recortar la
  // selección para no cotizar más gente de la que cabe en el servicio.
  useEffect(() => {
    setFormData((prev) =>
      prev.extraHelpers > maxExtraHelpers ? { ...prev, extraHelpers: maxExtraHelpers } : prev
    )
  }, [maxExtraHelpers])

  // Si el cliente vuelve atrás y saca el refrigerador de la lista, el desarmado deja de
  // aplicar: se desmarca acá para que la pantalla no muestre un servicio cobrado que el
  // cálculo ya descartó.
  useEffect(() => {
    if (!fridgePresent) {
      setFormData((prev) => (prev.fridgeDisassembly ? { ...prev, fridgeDisassembly: false } : prev))
    }
  }, [fridgePresent])

  // Cargar servicios adicionales dinámicamente
  useEffect(() => {
    const loadAdditionalServices = async () => {
      try {
        setLoadingServices(true)
        const servicesData = await getAdditionalServices(items)
        setServices(servicesData)
      } catch (error) {
        console.error('Error loading additional services:', error)
        toast.error('Error al cargar servicios adicionales')
      } finally {
        setLoadingServices(false)
      }
    }
    loadAdditionalServices()
    // Depende de `fridgePresent` y no de `items`: el array de items es una referencia
    // nueva en cada render y dispararía el efecto en bucle. Lo único que cambia la
    // lista de servicios es que aparezca o desaparezca el refrigerador.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fridgePresent])

  const handleServiceToggle = (serviceId: string) => {
    setFormData({
      ...formData,
      [serviceId]: !formData[serviceId as keyof typeof formData],
    })
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return

    try {
      setIsUploadingPhotos(true)
      toast.loading(`Subiendo ${files.length} foto(s)...`, { id: 'upload-photos' })

      // Crear FormData con todas las fotos
      const uploadFormData = new FormData()
      Array.from(files).forEach(file => {
        uploadFormData.append('photos', file)
      })

      // Subir a Supabase Storage
      const response = await fetch('/api/photos/upload', {
        method: 'POST',
        body: uploadFormData
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || 'Error al subir las fotos')
      }

      const { urls } = await response.json()

      // Guardar las URLs (no los nombres de archivo)
      setFormData({
        ...formData,
        photos: [...formData.photos, ...urls],
      })

      toast.success(`${files.length} foto(s) subida(s) exitosamente`, { id: 'upload-photos' })
    } catch (error) {
      console.error('Error uploading photos:', error)
      toast.error(error instanceof Error ? error.message : 'Error al subir las fotos', { id: 'upload-photos' })
    } finally {
      setIsUploadingPhotos(false)
      // Limpiar el input para permitir subir las mismas fotos de nuevo si es necesario
      e.target.value = ''
    }
  }

  const removePhoto = (index: number) => {
    const newPhotos = formData.photos.filter((_, i) => i !== index)
    setFormData({ ...formData, photos: newPhotos })
  }

  const handleSubmit = () => {
    setAdditionalServices(formData)
    calculateTotals()
    toast.success('Servicios adicionales guardados')
    onNext()
  }

  const totalServicesPrice = services.reduce((sum, service) => {
    const key = service.id as keyof typeof formData
    // No incluir servicios que requieren contacto con ejecutivo en el total
    if (service.requiresContact) return sum
    return sum + (formData[key] ? service.price : 0)
  }, 0)

  return (
    <div className="max-w-4xl mx-auto animate-slide-up">
      <div className="mb-6 text-center">
        <h2 className="text-3xl font-bold text-gray-900 mb-2">Servicios Adicionales</h2>
        <p className="text-gray-600">
          Selecciona los servicios extras que necesites para tu mudanza
        </p>
      </div>

      <Card variant="elevated">
        {/* Servicios */}
        {loadingServices ? (
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto mb-4"></div>
            <p className="text-gray-600">Cargando servicios...</p>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 gap-4 mb-8">
            {services.map((service) => {
              const Icon = service.icon
              const isSelected = formData[service.id as keyof typeof formData]

              return (
                <div
                  key={service.id}
                  onClick={() => handleServiceToggle(service.id)}
                  className={`p-4 rounded-lg border-2 cursor-pointer transition-all hover:shadow-md ${isSelected
                    ? 'border-primary-600 bg-primary-50'
                    : 'border-gray-200 hover:border-primary-300'
                    }`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center ${isSelected ? 'bg-primary-600' : 'bg-gray-200'
                      }`}>
                      <Icon className={`w-5 h-5 ${isSelected ? 'text-white' : 'text-gray-600'}`} />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-1">
                        <h4 className="font-semibold">{service.name}</h4>
                        {!service.requiresContact && (
                          <span className="text-sm font-bold text-primary-600">
                            ${service.price.toLocaleString()}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-600">{service.description}</p>
                      {service.requiresContact && service.contactMessage && (
                        <p className="text-xs text-blue-600 mt-1 font-medium">
                          💬 {service.contactMessage}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Bultos grandes por escalera: no todo cabe en el ascensor, y hay edificios sin
            ascensor para carga. No cambia el precio; le avisa al equipo qué le espera. */}
        <label
          className={`mb-8 flex cursor-pointer items-start gap-3 rounded-lg border-2 p-4 transition-all hover:shadow-md ${
            formData.stairsCarry ? 'border-primary-600 bg-primary-50' : 'border-gray-200 hover:border-primary-300'
          }`}
        >
          <input
            type="checkbox"
            checked={formData.stairsCarry}
            onChange={(e) => setFormData({ ...formData, stairsCarry: e.target.checked })}
            className="mt-1 h-5 w-5 shrink-0 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
          />
          <span className="flex-1">
            <span className="block font-semibold text-gray-900">Hay muebles grandes que deben ir por la escalera</span>
            <span className="mt-0.5 block text-sm text-gray-600">
              Márcalo si algún mueble o bulto de gran tamaño no cabe en el ascensor y hay que subirlo o bajarlo por la
              escalera, aunque el edificio tenga ascensor.
            </span>
            <span className="mt-1 block text-xs font-medium text-blue-600">
              Así llevamos al equipo y el tiempo que ese traslado necesita.
            </span>
          </span>
        </label>

        {/* Cuadrilla: cuánta gente va y cuánta más se puede sumar */}
        <div className="mb-8 rounded-lg border-2 border-gray-200 p-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-primary-600 flex items-center justify-center shrink-0">
              <Users className="w-5 h-5 text-white" />
            </div>
            <div className="flex-1">
              <h4 className="font-semibold">Personas para el traslado</h4>
              <p className="text-sm text-gray-600">
                Más personas es más rápido y con más cuidado en cada mueble.
              </p>

              {crewByWeight > crewConfig.includedPeople && (
                <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  Tu carga incluye un artículo pesado, así que el servicio ya va con{' '}
                  <strong>{crewByWeight} personas</strong>. Es obligatorio por seguridad.
                </p>
              )}

              <div className="mt-4 flex items-center gap-4">
                <button
                  type="button"
                  aria-label="Quitar un ayudante"
                  onClick={() =>
                    setFormData({ ...formData, extraHelpers: Math.max(0, formData.extraHelpers - 1) })
                  }
                  disabled={formData.extraHelpers <= 0}
                  className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-gray-300 text-gray-700 transition-colors hover:border-primary-400 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Minus className="h-4 w-4" />
                </button>

                <div className="text-center">
                  <div className="text-2xl font-bold text-gray-900">
                    {crewByWeight + formData.extraHelpers}
                  </div>
                  <div className="text-xs text-gray-500">
                    {crewByWeight + formData.extraHelpers === 1 ? 'persona' : 'personas'} en total
                  </div>
                </div>

                <button
                  type="button"
                  aria-label="Agregar un ayudante"
                  onClick={() =>
                    setFormData({
                      ...formData,
                      extraHelpers: Math.min(maxExtraHelpers, formData.extraHelpers + 1),
                    })
                  }
                  disabled={formData.extraHelpers >= maxExtraHelpers}
                  className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-gray-300 text-gray-700 transition-colors hover:border-primary-400 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Plus className="h-4 w-4" />
                </button>

                {helpersCost > 0 && (
                  <span className="ml-auto text-sm font-bold text-primary-600">
                    +${helpersCost.toLocaleString()}
                  </span>
                )}
              </div>

              <p className="mt-2 text-xs text-gray-500">
                Incluidas en el precio: {crewConfig.includedPeople}. Cada persona adicional
                son ${crewConfig.pricePerExtraPerson.toLocaleString()}. Máximo{' '}
                {crewConfig.maxPeople}.
              </p>
            </div>
          </div>
        </div>

        {/* Total servicios */}
        {totalServicesPrice > 0 && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6">
            <div className="flex items-center justify-between">
              <span className="font-semibold">Total Servicios Adicionales:</span>
              <span className="text-xl font-bold text-green-600">
                ${totalServicesPrice.toLocaleString()}
              </span>
            </div>
          </div>
        )}

        {/* Observaciones */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            <FileText className="inline w-4 h-4 mr-1" />
            Observaciones Especiales
          </label>
          <textarea
            placeholder="¿Hay algo que debamos saber? Ej: Calles estrechas, items muy delicados, restricciones de horario, etc."
            value={formData.observations}
            onChange={(e) => setFormData({ ...formData, observations: e.target.value })}
            rows={4}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
          />
          <p className="text-xs text-gray-500 mt-1">
            Cualquier información adicional que nos ayude a realizar mejor tu mudanza
          </p>
        </div>

        {/* Fotos */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            <Camera className="inline w-4 h-4 mr-1" />
            Fotos de Items (Opcional)
          </label>
          <p className="text-sm text-gray-600 mb-3">
            Sube fotos de items especiales, objetos de valor o situaciones particulares
          </p>

          <label className="block w-full">
            <div className={`border-2 border-dashed border-gray-300 rounded-lg p-8 text-center transition-colors ${
              isUploadingPhotos 
                ? 'bg-gray-100 cursor-wait' 
                : 'hover:border-primary-400 hover:bg-primary-50 cursor-pointer'
            }`}>
              <Camera className={`w-12 h-12 mx-auto mb-2 ${isUploadingPhotos ? 'text-gray-300 animate-pulse' : 'text-gray-400'}`} />
              <p className="text-sm font-medium text-gray-700">
                {isUploadingPhotos ? 'Subiendo fotos...' : 'Click para subir fotos'}
              </p>
              <p className="text-xs text-gray-500 mt-1">
                JPG, PNG o WEBP (Máx. 5MB cada una)
              </p>
            </div>
            <input
              type="file"
              multiple
              accept="image/*"
              onChange={handleFileUpload}
              className="hidden"
              disabled={isUploadingPhotos}
            />
          </label>

          {/* Lista de fotos */}
          {formData.photos.length > 0 && (
            <div className="mt-4 grid grid-cols-2 md:grid-cols-3 gap-3">
              {formData.photos.map((u) => toHiddenFileUrl(u)).map((photoUrl, index) => (
                <div
                  key={index}
                  className="relative group rounded-lg overflow-hidden border-2 border-gray-200 hover:border-primary-400 transition-all"
                >
                  {/* Preview de la imagen */}
                  <div className="aspect-square bg-gray-100">
                    <img
                      src={photoUrl}
                      alt={`Foto ${index + 1}`}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  </div>
                  
                  {/* Overlay con botón eliminar */}
                  <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-40 transition-all flex items-center justify-center">
                    <button
                      onClick={() => removePhoto(index)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity bg-red-500 hover:bg-red-600 text-white px-3 py-1 rounded-full text-sm font-medium"
                    >
                      Eliminar
                    </button>
                  </div>
                  
                  {/* Número de foto */}
                  <div className="absolute top-2 left-2 bg-white bg-opacity-90 px-2 py-1 rounded text-xs font-semibold text-gray-700">
                    #{index + 1}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Info */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mt-6">
          <p className="text-sm text-blue-800">
            <strong>💡 Tip:</strong> Los servicios de desarme y armado pueden ahorrarte mucho tiempo
            y garantizan que tus muebles lleguen en perfecto estado. El armado de cajas es
            altamente recomendado para objetos frágiles o de valor.
          </p>
          <p className="text-sm text-blue-800 mt-3">
            <strong>📋 Nota:</strong> Los valores indicados corresponden a un servicio estándar.
            En casos de mayor volumen, complejidad o materiales especiales, podría aplicarse un
            ajuste. Te contactaremos previamente si fuera necesario realizar alguna modificación al presupuesto.
          </p>
        </div>
      </Card>

      {/* Botones */}
      <div className="flex gap-4 mt-6">
        <Button type="button" onClick={onPrevious} variant="outline" className="flex-1">
          ← Volver
        </Button>
        <Button onClick={handleSubmit} variant="brand" className="flex-1">
          Ver Resumen →
        </Button>
      </div>
    </div>
  )
}

