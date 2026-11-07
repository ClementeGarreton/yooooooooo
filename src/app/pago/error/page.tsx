'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import { XCircle, Home, RefreshCw, Loader2 } from 'lucide-react'

function PaymentErrorContent() {
    const searchParams = useSearchParams()
    const [errorReason, setErrorReason] = useState('')
    const [errorMessage, setErrorMessage] = useState('')

    useEffect(() => {
        const reason = searchParams.get('reason') || 'unknown'
        setErrorReason(reason)

        // Determinar mensaje según la razón
        switch (reason) {
            case 'rejected':
                setErrorMessage('Tu pago fue rechazado. Por favor, verifica tus datos e intenta nuevamente.')
                break
            case 'cancelled':
                setErrorMessage('Cancelaste el proceso de pago. Puedes intentar nuevamente cuando lo desees.')
                break
            case 'pending':
                setErrorMessage('El pago está pendiente de confirmación. Te notificaremos cuando se complete.')
                break
            case 'no_token':
                setErrorMessage('No se recibió información del pago. Por favor, intenta nuevamente.')
                break
            case 'error':
                setErrorMessage('Ocurrió un error al procesar tu pago. Por favor, intenta nuevamente.')
                break
            default:
                setErrorMessage('Ocurrió un problema con tu pago. Por favor, intenta nuevamente.')
        }
    }, [searchParams])

    const getIcon = () => {
        if (errorReason === 'cancelled') {
            return <XCircle className="w-16 h-16 text-yellow-600" />
        }
        return <XCircle className="w-16 h-16 text-red-600" />
    }

    const getIconBgColor = () => {
        if (errorReason === 'cancelled') {
            return 'bg-yellow-100'
        }
        return 'bg-red-100'
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-red-50 via-white to-orange-50 py-12 px-4">
            <div className="max-w-2xl mx-auto">
                <Card variant="elevated" className="py-12">
                    {/* Icono de error */}
                    <div className={`w-24 h-24 ${getIconBgColor()} rounded-full flex items-center justify-center mx-auto mb-6`}>
                        {getIcon()}
                    </div>

                    {/* Título */}
                    <h1 className="text-4xl font-bold text-gray-900 mb-4 text-center">
                        {errorReason === 'cancelled' ? '¡Pago Cancelado!' : '¡Pago No Completado!'}
                    </h1>

                    <p className="text-lg text-gray-600 mb-8 text-center">
                        {errorMessage}
                    </p>

                    {/* Información adicional */}
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mb-8">
                        <h3 className="font-semibold text-blue-900 mb-3">💡 ¿Qué puedes hacer?</h3>
                        <ul className="space-y-2 text-sm text-gray-700">
                            {errorReason === 'rejected' && (
                                <>
                                    <li className="flex items-start gap-2">
                                        <span className="text-blue-600 mt-0.5">•</span>
                                        <span>Verifica que tu tarjeta tenga fondos suficientes</span>
                                    </li>
                                    <li className="flex items-start gap-2">
                                        <span className="text-blue-600 mt-0.5">•</span>
                                        <span>Confirma que los datos de tu tarjeta sean correctos</span>
                                    </li>
                                    <li className="flex items-start gap-2">
                                        <span className="text-blue-600 mt-0.5">•</span>
                                        <span>Intenta con otro método de pago</span>
                                    </li>
                                </>
                            )}
                            {errorReason === 'cancelled' && (
                                <>
                                    <li className="flex items-start gap-2">
                                        <span className="text-blue-600 mt-0.5">•</span>
                                        <span>Puedes volver a intentar el pago cuando lo desees</span>
                                    </li>
                                    <li className="flex items-start gap-2">
                                        <span className="text-blue-600 mt-0.5">•</span>
                                        <span>Tu cotización sigue disponible</span>
                                    </li>
                                </>
                            )}
                            {(errorReason === 'error' || errorReason === 'no_token') && (
                                <>
                                    <li className="flex items-start gap-2">
                                        <span className="text-blue-600 mt-0.5">•</span>
                                        <span>Intenta nuevamente en unos minutos</span>
                                    </li>
                                    <li className="flex items-start gap-2">
                                        <span className="text-blue-600 mt-0.5">•</span>
                                        <span>Si el problema persiste, contáctanos</span>
                                    </li>
                                </>
                            )}
                            {errorReason === 'pending' && (
                                <>
                                    <li className="flex items-start gap-2">
                                        <span className="text-blue-600 mt-0.5">•</span>
                                        <span>Recibirás un correo cuando se confirme el pago</span>
                                    </li>
                                    <li className="flex items-start gap-2">
                                        <span className="text-blue-600 mt-0.5">•</span>
                                        <span>Esto puede tomar algunos minutos</span>
                                    </li>
                                </>
                            )}
                        </ul>
                    </div>

                    {/* Acciones */}
                    <div className="space-y-3">
                        <Link href="/cotizador">
                            <Button variant="primary" className="w-full" size="lg">
                                <RefreshCw className="w-5 h-5 mr-2" />
                                Intentar Nuevamente
                            </Button>
                        </Link>

                        <Link href="/">
                            <Button variant="outline" className="w-full" size="lg">
                                <Home className="w-5 h-5 mr-2" />
                                Volver al Inicio
                            </Button>
                        </Link>
                    </div>

                    {/* Información de contacto */}
                    <div className="mt-8 pt-6 border-t border-gray-200 text-center">
                        <p className="text-sm text-gray-600 mb-2">
                            ¿Necesitas ayuda? Contáctanos:
                        </p>
                        <p className="text-sm font-semibold text-primary-600">
                            📞 +56 9 5233 4799 | 📧 contacto@yomeencargo.cl
                        </p>
                    </div>
                </Card>

                {/* Nota de seguridad */}
                <div className="mt-6 text-center">
                    <p className="text-xs text-gray-500">
                        🔒 Todos los pagos son procesados de forma segura a través de Flow
                    </p>
                </div>
            </div>
        </div>
    )
}

function LoadingFallback() {
    return (
        <div className="min-h-screen bg-gradient-to-br from-red-50 via-white to-orange-50 py-12 px-4">
            <div className="max-w-2xl mx-auto">
                <Card variant="elevated" className="py-12">
                    <div className="flex flex-col items-center justify-center">
                        <Loader2 className="w-16 h-16 text-primary-600 animate-spin mb-4" />
                        <p className="text-gray-600">Cargando información...</p>
                    </div>
                </Card>
            </div>
        </div>
    )
}

export default function PaymentErrorPage() {
    return (
        <Suspense fallback={<LoadingFallback />}>
            <PaymentErrorContent />
        </Suspense>
    )
}
