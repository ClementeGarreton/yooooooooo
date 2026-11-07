'use client'

import { isValidRut } from '@/lib/rut'
import { useState, useEffect } from 'react'
import { useQuoteStore } from '@/store/quoteStore'
import Button from '../ui/Button'
import Input from '../ui/Input'
import Checkbox from '../ui/Checkbox'
import Card from '../ui/Card'
import { validateEmail, validatePhone, normalizeChileanPhone } from '@/lib/utils'
import { User, Mail, Phone, Building2 } from 'lucide-react'
import toast from 'react-hot-toast'

interface PersonalInfoStepProps {
  onNext: () => void
  onPrevious: () => void
}

export default function PersonalInfoStep({ onNext, onPrevious }: PersonalInfoStepProps) {
  const { personalInfo, setPersonalInfo } = useQuoteStore()
  
  const [formData, setFormData] = useState({
    name: personalInfo?.name || '',
    email: personalInfo?.email || '',
    phone: personalInfo?.phone || '',
    rut: personalInfo?.rut || '',
    isCompany: personalInfo?.isCompany || false,
    companyName: personalInfo?.companyName || '',
    companyRut: personalInfo?.companyRut || '',
  })

  const [errors, setErrors] = useState<Record<string, string>>({})

  const validate = () => {
    const newErrors: Record<string, string> = {}

    if (!formData.name.trim()) {
      newErrors.name = 'El nombre es requerido'
    }

    if (!formData.email.trim()) {
      newErrors.email = 'El email es requerido'
    } else if (!validateEmail(formData.email)) {
      newErrors.email = 'Email inválido'
    }

    if (!formData.phone.trim()) {
      newErrors.phone = 'El teléfono es requerido'
    } else if (!validatePhone(formData.phone)) {
      newErrors.phone = 'Revisa el teléfono: debe tener entre 8 y 15 dígitos'
    }

    // Opcional: solo se revisa si la persona lo escribió.
    if (formData.rut.trim() && !isValidRut(formData.rut)) {
      newErrors.rut = 'Revisa el RUT: el dígito verificador no calza'
    }

    if (formData.isCompany && !formData.companyName.trim()) {
      newErrors.companyName = 'La razón social es requerida para emitir factura'
    }

    if (formData.isCompany && !formData.companyRut.trim()) {
      newErrors.companyRut = 'El RUT es requerido para emitir factura'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    
    if (validate()) {
      // Forzar el teléfono al formato +56 9 XXXX XXXX para que WhatsApp siempre funcione
      const normalizedPhone = normalizeChileanPhone(formData.phone)
      const normalized = { ...formData, phone: normalizedPhone }
      setFormData(normalized)
      setPersonalInfo(normalized)
      toast.success('Datos guardados correctamente')
      onNext()
    } else {
      toast.error('Por favor corrige los errores del formulario')
    }
  }

  return (
    <div className="max-w-2xl mx-auto animate-slide-up">
      <Card variant="elevated">
        <div className="mb-6">
          <h2 className="text-3xl font-bold text-gray-900 mb-2">Datos Personales</h2>
          <p className="text-gray-600">
            Necesitamos tu información para enviarte la cotización y contactarte
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Nombre */}
          <div className="relative">
            <User className="absolute left-3 top-9 w-5 h-5 text-gray-400" />
            <Input
              label="Nombre Completo"
              placeholder="Juan Pérez"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="pl-10"
              error={errors.name}
              required
            />
          </div>

          {/* Email */}
          <div className="relative">
            <Mail className="absolute left-3 top-9 w-5 h-5 text-gray-400" />
            <Input
              label="Correo Electrónico"
              type="email"
              placeholder="juan@ejemplo.com"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              className="pl-10"
              error={errors.email}
              required
            />
          </div>

          {/* Teléfono */}
          <div className="relative">
            <Phone className="absolute left-3 top-9 w-5 h-5 text-gray-400" />
            <Input
              label="Teléfono"
              type="tel"
              placeholder="+56 9 1234 5678"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              className="pl-10"
              error={errors.phone}
              helperText="Formato: +56 9 1234 5678"
              required
            />
          </div>

          {/* RUT de la persona (opcional) */}
          <div>
            <Input
              label="RUT (opcional)"
              placeholder="12.345.678-9"
              value={formData.rut}
              onChange={(e) => setFormData({ ...formData, rut: e.target.value })}
              error={errors.rut}
              helperText="Sirve para identificarte en tu cuenta de cliente."
            />
          </div>

          {/* Necesita Factura */}
          <div className="bg-gray-50 p-4 rounded-lg">
            <Checkbox
              label="¿Necesitas Factura?"
              checked={formData.isCompany}
              onChange={(e) => setFormData({ ...formData, isCompany: e.target.checked })}
            />
          </div>

          {/* Datos Empresa (condicional) */}
          {formData.isCompany && (
            <div className="space-y-4 animate-slide-down">
              <div className="relative">
                <Building2 className="absolute left-3 top-9 w-5 h-5 text-gray-400" />
                <Input
                  label="Razón Social / Nombre de la Empresa"
                  placeholder="Mi Empresa S.A."
                  value={formData.companyName}
                  onChange={(e) => setFormData({ ...formData, companyName: e.target.value })}
                  className="pl-10"
                  error={errors.companyName}
                  required={formData.isCompany}
                />
              </div>
              <div>
                <Input
                  label="RUT"
                  placeholder="12.345.678-9"
                  value={formData.companyRut}
                  onChange={(e) => setFormData({ ...formData, companyRut: e.target.value })}
                  error={errors.companyRut}
                  helperText="Formato: 12.345.678-9"
                  required={formData.isCompany}
                />
              </div>
            </div>
          )}

          {/* Info adicional */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <p className="text-sm text-blue-800">
              <strong>📧 Recibirás:</strong> Cotización detallada por email, confirmación de reserva 
              y seguimiento del servicio vía WhatsApp.
            </p>
          </div>

          {/* Botones */}
          <div className="flex gap-4 pt-4">
            <Button
              type="button"
              onClick={onPrevious}
              variant="outline"
              className="flex-1"
            >
              ← Volver
            </Button>
            <Button type="submit" variant="brand" className="flex-1">
              Continuar →
            </Button>
          </div>
        </form>
      </Card>
    </div>
  )
}

