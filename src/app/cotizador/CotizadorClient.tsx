'use client'

import { useState, useEffect, useRef } from 'react'
import dynamic from 'next/dynamic'
import WelcomeScreen from '@/components/steps/WelcomeScreen'

// Los pasos se bajan recién cuando se usan: quien entra a la bienvenida no carga el
// resumen (con el generador de PDF) ni el resto del formulario.
const stepLoading = () => (
  <div className="flex justify-center py-16">
    <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary-600" />
  </div>
)
const PersonalInfoStep = dynamic(() => import('@/components/steps/PersonalInfoStep'), { loading: stepLoading })
const DateTimeStep = dynamic(() => import('@/components/steps/DateTimeStep'), { loading: stepLoading })
const AddressStep = dynamic(() => import('@/components/steps/AddressStep'), { loading: stepLoading })
const PropertyDetailsStep = dynamic(() => import('@/components/steps/PropertyDetailsStep'), { loading: stepLoading })
const ItemsSelectionStep = dynamic(() => import('@/components/steps/ItemsSelectionStep'), { loading: stepLoading })
const AdditionalServicesStep = dynamic(() => import('@/components/steps/AdditionalServicesStep'), { loading: stepLoading })
const SummaryStep = dynamic(() => import('@/components/steps/SummaryStep'), { loading: stepLoading })
import { useQuoteStore } from '@/store/quoteStore'
import ProgressBar from '@/components/ui/ProgressBar'
import Navbar from '@/components/landing/Navbar'
import Footer from '@/components/landing/Footer'

const steps = [
  { id: 0, name: 'Bienvenida', component: WelcomeScreen },
  { id: 1, name: 'Datos Personales', component: PersonalInfoStep },
  { id: 2, name: 'Fecha y Hora', component: DateTimeStep },
  { id: 3, name: 'Direcciones', component: AddressStep },
  { id: 4, name: 'Detalles de Propiedad', component: PropertyDetailsStep },
  { id: 5, name: 'Selección de Items', component: ItemsSelectionStep },
  { id: 6, name: 'Servicios Adicionales', component: AdditionalServicesStep },
  { id: 7, name: 'Resumen', component: SummaryStep },
]

/**
 * El paso inicial y el código llegan del servidor (page.tsx lee la URL). Antes se leían con
 * useSearchParams, y eso obligaba a dibujar todo en el navegador: el HTML que veía Google
 * llegaba sin título ni texto. Así la bienvenida sale completa desde el servidor.
 */
export default function CotizadorClient({ startOnline, codigo }: { startOnline: boolean; codigo: string }) {
  // Los CTA de la home que ya dicen "online" (Hero, CtaFinal, Servicios) enlazan a
  // /cotizador?start=online para saltar directo al paso 1 y evitar el selector de
  // modalidad (Bienvenida). Solo el CTA del Navbar ("Cotizar Ahora", sin este parámetro)
  // debe mostrar el selector Online/Domicilio.
  const [currentStep, setCurrentStep] = useState(startOnline ? 1 : 0)
  // El paso 1 lee lo guardado en el navegador: se dibuja recién en el cliente, como antes.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const { resetQuote, isConfirmed } = useQuoteStore()

  // Link de un recomendador (conserje): `?codigo=` deja el código guardado para el resumen,
  // donde se aplica solo. Se guarda en el navegador por si cotiza otro día.
  useEffect(() => {
    const code = codigo.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20)
    if (!code) return
    try {
      localStorage.setItem('yme_codigo', code)
    } catch {}
  }, [codigo])
  const mainContentRef = useRef<HTMLDivElement>(null)

  // Hacer scroll automático cuando cambia el paso
  useEffect(() => {
    // Pequeño delay para asegurar que el DOM se ha actualizado
    const timeoutId = setTimeout(() => {
      // Scroll al inicio de la página
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

  const isWelcome = currentStep === 0

  // .theme-cotizador tiñe de VERDE (identidad de la landing) todos los tokens `primary`
  // dentro del cotizador, sin afectar el resto del sistema. El Navbar y el Footer de la
  // landing se muestran en TODOS los pasos para que el cotizador se sienta la misma web.
  return (
    <div className="theme-cotizador">
      <Navbar />

      <main className="min-h-screen pt-20 md:pt-24">
        {currentStep > 0 && mounted && (
          <ProgressBar
            currentStep={currentStep - 1}
            totalSteps={steps.length - 1}
            isCompleted={isConfirmed}
            onStepClick={(step) => {
              setCurrentStep(step + 1)
            }}
          />
        )}

        <div ref={mainContentRef} className="max-w-[1180px] mx-auto px-6 py-8">
          {(currentStep === 0 || mounted) && (
            <CurrentStepComponent
              onNext={handleNext}
              onPrevious={handlePrevious}
              onReset={handleReset}
              currentStep={currentStep}
            />
          )}
        </div>
      </main>

      <Footer />
    </div>
  )
}

