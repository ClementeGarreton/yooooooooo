'use client'

import { useState, useEffect, useRef } from 'react'
import HomePersonalInfoStep from '@/components/steps/home/HomePersonalInfoStep'
import HomeAddressStep from '@/components/steps/home/HomeAddressStep'
import HomeDateTimeStep from '@/components/steps/home/HomeDateTimeStep'
import HomeSummaryStep from '@/components/steps/home/HomeSummaryStep'
import { useHomeQuoteStore } from '@/store/homeQuoteStore'
import ProgressBar from '@/components/ui/ProgressBar'
import ChatBot from '@/components/ui/ChatBot'
import { formatHomeVisitPrice } from '@/lib/homeVisitPricing'
import { useHomeVisitPrice } from '@/lib/useHomeVisitPrice'
import Link from 'next/link'

const steps = [
  { id: 0, name: 'Datos Personales', component: HomePersonalInfoStep },
  { id: 1, name: 'Dirección de Visita', component: HomeAddressStep },
  { id: 2, name: 'Fecha y Hora', component: HomeDateTimeStep },
  { id: 3, name: 'Resumen y Pago', component: HomeSummaryStep },
]

export default function DomicilioPage() {
  const [currentStep, setCurrentStep] = useState(0)
  const { resetQuote, isConfirmed } = useHomeQuoteStore()
  const homeVisitPrice = useHomeVisitPrice()
  const mainContentRef = useRef<HTMLDivElement>(null)

  // Hacer scroll automático cuando cambia el paso
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }, 100)

    return () => clearTimeout(timeoutId)
  }, [currentStep])

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1)
    }
  }

  const handlePrevious = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1)
    }
  }

  const handleReset = () => {
    resetQuote()
    setCurrentStep(0)
  }

  const CurrentStepComponent = steps[currentStep].component

  return (
    <main className="min-h-screen">
      {/* Barra de progreso */}
      <ProgressBar 
        currentStep={currentStep} 
        totalSteps={steps.length}
        isCompleted={isConfirmed}
        stepLabels={steps.map(s => s.name)}
        onStepClick={(step) => {
          setCurrentStep(step)
        }}
      />
      
      <div ref={mainContentRef} className="container mx-auto px-4 py-8">
        {/* Header con información del servicio */}
        <div className="max-w-3xl mx-auto mb-8">
          <div className="bg-gradient-to-r from-primary-50 to-secondary-50 rounded-lg p-6 border border-primary-200">
            <h1 className="text-2xl font-bold text-gray-900 mb-2">
              Cotización de mudanza a domicilio en Santiago
            </h1>
            <p className="text-gray-700 mb-4">
              Te visitamos en tu hogar para realizar una cotización completa y personalizada
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-white rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-primary-600">{formatHomeVisitPrice(homeVisitPrice)}</p>
                <p className="text-xs text-gray-600">Precio fijo</p>
              </div>
              <div className="bg-white rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-secondary-600">RM</p>
                <p className="text-xs text-gray-600">Solo Región Metropolitana</p>
              </div>
            </div>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mt-4">
              <p className="text-sm text-blue-800 text-center">
                💡 <strong>Importante:</strong> Si contratas el servicio de mudanza o transporte después de la cotización, 
                los {formatHomeVisitPrice(homeVisitPrice)} pagados se descontarán del valor total del flete.
              </p>
            </div>
          </div>
        </div>

        {/* Componente del paso actual */}
        <CurrentStepComponent
          onNext={handleNext}
          onPrevious={handlePrevious}
          onReset={handleReset}
        />

        {/* Qué incluye la visita: texto para quien llega desde Google antes de agendar. */}
        <section className="max-w-3xl mx-auto mt-16 space-y-6 text-gray-700">
          <h2 className="text-xl font-bold text-gray-900">¿Cómo funciona la cotización a domicilio?</h2>
          <p>
            Vamos a tu casa, departamento u oficina, revisamos lo que hay que trasladar y te entregamos una cotización
            completa y personalizada de tu mudanza. Es útil cuando son muchas cosas, cuando no sabes bien cuánto volumen
            tienes o cuando prefieres que alguien del equipo lo vea antes de reservar.
          </p>
          <ol className="list-decimal pl-5 space-y-1">
            <li>Dejas tus datos de contacto.</li>
            <li>Indicas la dirección donde hacemos la visita.</li>
            <li>Eliges el día y la hora.</li>
            <li>Revisas el resumen y pagas la visita en línea.</li>
          </ol>
          <h2 className="text-xl font-bold text-gray-900">Precio y cobertura</h2>
          <p>
            La visita tiene un precio fijo de {formatHomeVisitPrice(homeVisitPrice)} y por ahora la hacemos solo en la
            Región Metropolitana. Si después contratas la mudanza o el transporte con nosotros, ese monto se descuenta
            del valor total del flete.
          </p>
          <h2 className="text-xl font-bold text-gray-900">¿Prefieres no esperar la visita?</h2>
          <p>
            Con el{' '}
            <Link href="/cotizador?start=online" className="font-semibold text-primary-600 hover:underline">
              cotizador online
            </Link>{' '}
            eliges tus artículos y recibes el precio al instante, sin costo. Si tienes dudas, revisa{' '}
            <Link href="/blog/como-preparar-tu-mudanza" className="font-semibold text-primary-600 hover:underline">
              cómo preparar tu mudanza
            </Link>
            .
          </p>
        </section>
      </div>

      <ChatBot />

      {/* Footer */}
      <footer className="bg-gray-50 border-t border-gray-200 py-6 mt-12">
        <div className="container mx-auto px-4 text-center">
          <p className="text-xs text-gray-500">
            ©2025 - Crafted by{' '}
            <a 
              href="https://vanlookstudio.com" 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-primary-600 hover:text-primary-700 font-medium transition-colors"
            >
              vanlookstudio.com
            </a>
          </p>
        </div>
      </footer>
    </main>
  )
}
