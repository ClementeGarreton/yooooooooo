'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useHomeQuoteStore } from '@/store/homeQuoteStore'
import Card from '@/components/ui/Card'
import Input from '@/components/ui/Input'
import Button from '@/components/ui/Button'
import { User, Mail, Phone } from 'lucide-react'
import { normalizeChileanPhone, validatePhone } from '@/lib/utils'

interface HomePersonalInfoStepProps {
  onNext: () => void
  onPrevious: () => void
}

export default function HomePersonalInfoStep({ onNext, onPrevious }: HomePersonalInfoStepProps) {
  const router = useRouter()
  const { personalInfo, setPersonalInfo } = useHomeQuoteStore()
  const [formData, setFormData] = useState({
    name: personalInfo?.name || '',
    email: personalInfo?.email || '',
    phone: personalInfo?.phone || '',
  })
  const [errors, setErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    if (personalInfo) {
      setFormData({
        name: personalInfo.name,
        email: personalInfo.email,
        phone: personalInfo.phone,
      })
    }
  }, [personalInfo])

  const validateForm = () => {
    const newErrors: Record<string, string> = {}

    if (!formData.name.trim()) {
      newErrors.name = 'El nombre es requerido'
    }

    if (!formData.email.trim()) {
      newErrors.email = 'El email es requerido'
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = 'Email inválido'
    }

    if (!formData.phone.trim()) {
      newErrors.phone = 'El teléfono es requerido'
    } else if (!validatePhone(formData.phone)) {
      newErrors.phone = 'Revisa el teléfono: debe tener entre 8 y 15 dígitos'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    if (!validateForm()) {
      return
    }

    setPersonalInfo({
      name: formData.name.trim(),
      email: formData.email.trim(),
      phone: normalizeChileanPhone(formData.phone.trim()),
    })

    onNext()
  }

  return (
    <div className="max-w-2xl mx-auto">
      <Card>
        <div className="mb-6">
          <h2 className="text-3xl font-bold text-gray-900 mb-2">
            Cotización a Domicilio
          </h2>
          <p className="text-gray-600">
            Ingresa tus datos personales para coordinar la visita
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Nombre */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Nombre Completo *
            </label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
              <Input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Juan Pérez"
                className="pl-10"
                error={errors.name}
              />
            </div>
            {errors.name && (
              <p className="text-sm text-red-600 mt-1">{errors.name}</p>
            )}
          </div>

          {/* Email */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Email *
            </label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
              <Input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="juan@ejemplo.com"
                className="pl-10"
                error={errors.email}
              />
            </div>
            {errors.email && (
              <p className="text-sm text-red-600 mt-1">{errors.email}</p>
            )}
          </div>

          {/* Teléfono */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Teléfono *
            </label>
            <div className="relative">
              <Phone className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
              <Input
                type="tel"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                placeholder="9 XXXX XXXX"
                className="pl-10"
                error={errors.phone}
              />
            </div>
            {errors.phone && (
              <p className="text-sm text-red-600 mt-1">{errors.phone}</p>
            )}
            <p className="text-xs text-gray-500 mt-1">
              Formato: 9 XXXX XXXX o +56 9 XXXX XXXX
            </p>
          </div>

          {/* Botones */}
          <div className="flex justify-between pt-4">
            <Button
              type="button"
              onClick={() => router.push('/cotizador')}
              variant="outline"
            >
              ← Volver
            </Button>
            <Button type="submit">
              Continuar →
            </Button>
          </div>
        </form>
      </Card>
    </div>
  )
}
