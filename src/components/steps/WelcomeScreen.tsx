'use client'

import { Truck, Clock, Shield, DollarSign, CheckCircle, TrendingDown, Home } from 'lucide-react'
import { useRouter } from 'next/navigation'
import Button from '../ui/Button'
import Card from '../ui/Card'
import { formatHomeVisitPrice } from '@/lib/homeVisitPricing'
import { useHomeVisitPrice } from '@/lib/useHomeVisitPrice'

interface WelcomeScreenProps {
  onNext: () => void
}

export default function WelcomeScreen({ onNext }: WelcomeScreenProps) {
  const router = useRouter()
  const homeVisitPrice = useHomeVisitPrice()

  return (
    <div className="max-w-6xl mx-auto">
      {/* Hero Section */}
      <div className="text-center mb-12 animate-fade-in">
        <h1 className="text-5xl md:text-6xl font-extrabold tracking-[-0.03em] text-gray-900 mb-4">
          Cotiza tu Mudanza en <span className="text-primary-600">Minutos</span>
        </h1>
        <p className="text-xl text-gray-600 mb-8 max-w-3xl mx-auto">
          Sistema inteligente de cotización para mudanzas y fletes. 
          Elige la modalidad que prefieras.
        </p>

        {/* Opciones de cotización */}
        <div className="grid md:grid-cols-2 gap-6 max-w-4xl mx-auto mb-8">
          {/* Cotizador Online */}
          <Card className="hover:shadow-2xl transition-all duration-300 border-2 hover:border-primary-500 h-full">
            <div className="text-center flex flex-col h-full">
              <div className="w-20 h-20 bg-primary-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Truck className="w-10 h-10 text-primary-600" />
              </div>
              <h3 className="text-2xl font-bold mb-3">Cotizador Online</h3>
              <p className="text-gray-600 mb-4 min-h-[3rem]">
                Completa el formulario y obtén tu cotización instantánea
              </p>
              <ul className="text-sm text-gray-600 mb-4 space-y-2 text-left">
                <li className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-600 flex-shrink-0" />
                  Cotización inmediata
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-600 flex-shrink-0" />
                  Reserva tu fecha al instante
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-600 flex-shrink-0" />
                  Precio transparente
                </li>
              </ul>
              <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 mb-6 text-left">
                <p className="text-xs text-green-800">
                  🛋️ <strong>Solo marca lo que vas a mover</strong> y nuestro sistema calcula el precio exacto en segundos. ¡Sin llamadas ni esperas!
                </p>
              </div>
              <Button onClick={onNext} variant="brand" size="lg" className="w-full mt-auto">
                Comenzar Cotización Online
              </Button>
            </div>
          </Card>

          {/* Cotizador a Domicilio */}
          <Card className="hover:shadow-2xl transition-all duration-300 border-2 hover:border-secondary-500 h-full">
            <div className="text-center flex flex-col h-full">
              <div className="w-20 h-20 bg-secondary-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Home className="w-10 h-10 text-secondary-600" />
              </div>
              <h3 className="text-2xl font-bold mb-3">Cotización a Domicilio</h3>
              <p className="text-gray-600 mb-4 min-h-[3rem]">
                Te visitamos para evaluar tu mudanza en persona
              </p>
              <ul className="text-sm text-gray-600 mb-4 space-y-2 text-left">
                <li className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-600 flex-shrink-0" />
                  Evaluación profesional en tu hogar
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-600 flex-shrink-0" />
                  Cotización detallada y personalizada
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-600 flex-shrink-0" />
                  <span><strong>{formatHomeVisitPrice(homeVisitPrice)}</strong> - Solo RM</span>
                </li>
              </ul>
              <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 mb-6 text-left">
                <p className="text-xs text-blue-800">
                  💡 <strong>¿Contratas después?</strong> Los {formatHomeVisitPrice(homeVisitPrice)} se descuentan del valor total de tu mudanza o flete.
                </p>
              </div>
              <Button
                onClick={() => router.push('/domicilio')}
                size="lg"
                className="w-full mt-auto bg-[#2C5282] hover:bg-[#1E3A5F]"
              >
                Solicitar Visita a Domicilio
              </Button>
            </div>
          </Card>
        </div>
      </div>

      {/* Features Grid */}
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 mb-12">
        <Card className="text-center hover:shadow-xl transition-shadow">
          <div className="w-16 h-16 bg-primary-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Clock className="w-8 h-8 text-primary-600" />
          </div>
          <h3 className="text-xl font-semibold mb-2">Rápido y Fácil</h3>
          <p className="text-gray-600">
            Completa el formulario en menos de 5 minutos y obtén tu cotización al instante
          </p>
        </Card>

        <Card className="text-center hover:shadow-xl transition-shadow">
          <div className="w-16 h-16 bg-secondary-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <DollarSign className="w-8 h-8 text-secondary-600" />
          </div>
          <h3 className="text-xl font-semibold mb-2">Precio Transparente</h3>
          <p className="text-gray-600">
            Sin sorpresas. Conoce el precio exacto antes de confirmar tu mudanza
          </p>
        </Card>

        <Card className="text-center hover:shadow-xl transition-shadow">
          <div className="w-16 h-16 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Shield className="w-8 h-8 text-purple-600" />
          </div>
          <h3 className="text-xl font-semibold mb-2">100% Seguro</h3>
          <p className="text-gray-600">
            Todos nuestros servicios incluyen seguro de transporte de mercancías
          </p>
        </Card>

        <Card className="text-center hover:shadow-xl transition-shadow">
          <div className="w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Truck className="w-8 h-8 text-orange-600" />
          </div>
          <h3 className="text-xl font-semibold mb-2">Flota Moderna</h3>
          <p className="text-gray-600">
            Vehículos nuevos y equipados para todo tipo de mudanzas
          </p>
        </Card>

        <Card className="text-center hover:shadow-xl transition-shadow">
          <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="w-8 h-8 text-blue-600" />
          </div>
          <h3 className="text-xl font-semibold mb-2">Personal Calificado</h3>
          <p className="text-gray-600">
            Equipo profesional con experiencia en mudanzas y manejo de objetos delicados
          </p>
        </Card>

        <Card className="text-center hover:shadow-xl transition-shadow">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <TrendingDown className="w-8 h-8 text-green-600" />
          </div>
          <h3 className="text-xl font-semibold mb-2">Descuentos</h3>
          <p className="text-gray-600">
            Obtén hasta 10% de descuento si eres flexible con la fecha de tu mudanza
          </p>
        </Card>
      </div>

      {/* How it works */}
      <Card className="bg-gradient-to-r from-primary-50 to-secondary-50 border-0 mb-8">
        <h2 className="text-3xl font-bold text-center mb-8">¿Cómo funciona?</h2>
        <div className="grid md:grid-cols-4 gap-6">
          {[
            { step: 1, title: 'Datos Personales', desc: 'Ingresa tu información de contacto' },
            { step: 2, title: 'Detalles de Mudanza', desc: 'Selecciona fecha, direcciones y tipo de vivienda' },
            { step: 3, title: 'Selecciona Items', desc: 'Marca todos los muebles y objetos a transportar' },
            { step: 4, title: 'Obtén tu Cotización', desc: 'Recibe precio instantáneo y confirma tu reserva' },
          ].map((item) => (
            <div key={item.step} className="text-center">
              <div className="w-12 h-12 bg-primary-600 text-[rgb(var(--primary-fg))] rounded-full flex items-center justify-center mx-auto mb-3 font-bold text-lg">
                {item.step}
              </div>
              <h3 className="font-semibold mb-1">{item.title}</h3>
              <p className="text-sm text-gray-600">{item.desc}</p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}

