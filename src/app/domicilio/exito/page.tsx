'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import { CheckCircle, Home, Loader2, Download } from 'lucide-react'
import { formatCurrency } from '@/lib/utils'
import { generateHomePDF } from '@/lib/homePdfGenerator'
import { useHomeVisitPrice } from '@/lib/useHomeVisitPrice'
import toast from 'react-hot-toast'

function PaymentSuccessContent() {
    const searchParams = useSearchParams()
    const [paymentInfo, setPaymentInfo] = useState({
        token: '',
        order: '',
        amount: '',
        bookingId: '',
        clientName: '',
        clientEmail: '',
        visitAddress: '',
    })
    const [isDownloading, setIsDownloading] = useState(false)
    const pdfAttempted = useRef(false)
    const [isPdfUploaded, setIsPdfUploaded] = useState(false)
    const [isUploadingPdf, setIsUploadingPdf] = useState(false)
    const homeVisitPrice = useHomeVisitPrice()

    useEffect(() => {
        setPaymentInfo({
            token: searchParams.get('token') || '',
            order: searchParams.get('order') || '',
            amount: searchParams.get('amount') || String(homeVisitPrice),
            bookingId: searchParams.get('bookingId') || '',
            clientName: searchParams.get('clientName') || '',
            clientEmail: searchParams.get('clientEmail') || '',
            visitAddress: searchParams.get('visitAddress') || '',
        })
    }, [searchParams, homeVisitPrice])

    // Subir PDF automáticamente cuando se carga la página
    useEffect(() => {
        const uploadPdfAutomatically = async () => {
            // Solo subir si tenemos los datos necesarios y no se ha subido ya
            // Usar bookingId si existe, o el order como fallback
            const identifier = paymentInfo.bookingId || paymentInfo.order
            
            if (!identifier || !paymentInfo.clientName || isPdfUploaded || isUploadingPdf) {
                console.log('[PDF Auto Domicilio] Esperando datos completos...', {
                    bookingId: paymentInfo.bookingId,
                    order: paymentInfo.order,
                    clientName: paymentInfo.clientName,
                    isPdfUploaded,
                    isUploadingPdf
                })
                return
            }
            // Un solo intento: al fallar, `isUploadingPdf` volvía a false y este efecto seguía subiendo.
            if (pdfAttempted.current) return
            pdfAttempted.current = true

            try {
                setIsUploadingPdf(true)
                console.log('[PDF Auto Domicilio] Iniciando subida automática de PDF...')
                console.log('[PDF Auto Domicilio] Booking ID:', paymentInfo.bookingId)
                console.log('[PDF Auto Domicilio] Cliente:', paymentInfo.clientName)

                // Generar el PDF (sin descargarlo)
                const pdfResult = await generateHomePDF(paymentInfo, false) // false = no descargar
                
                if (!pdfResult) {
                    console.error('[PDF Auto Domicilio] No se pudo generar el PDF')
                    return
                }

                console.log('[PDF Auto Domicilio] PDF generado:', pdfResult.fileName)

                // Subir a Supabase Storage
                const formData = new FormData()
                formData.append('pdf', pdfResult.blob, pdfResult.fileName)
                
                // Si tenemos bookingId (UUID), usarlo; si no, usar quoteId para buscar
                if (paymentInfo.bookingId) {
                    formData.append('bookingId', paymentInfo.bookingId)
                } else {
                    // Buscar por quote_id usando el patrón DOMICILIO-
                    formData.append('quoteId', `DOMICILIO-${paymentInfo.order}`)
                }
                formData.append('bookingType', 'domicilio')

                console.log('[PDF Auto Domicilio] Subiendo PDF...')

                const uploadResponse = await fetch('/api/bookings/upload-pdf', {
                    method: 'POST',
                    body: formData
                })

                if (uploadResponse.ok) {
                    const successData = await uploadResponse.json()
                    console.log('[PDF Auto Domicilio] PDF subido exitosamente:', successData)
                    setIsPdfUploaded(true)
                    toast.success('✅ Comprobante generado y guardado', { duration: 2000 })
                } else {
                    const errorData = await uploadResponse.json().catch(() => ({}))
                    console.error('[PDF Auto Domicilio] Error al subir:', errorData)
                    console.error('[PDF Auto Domicilio] Status:', uploadResponse.status)
                    // No es crítico si falla, el usuario puede descargar manualmente
                }
            } catch (error) {
                console.error('[PDF Auto Domicilio] Error:', error)
            } finally {
                setIsUploadingPdf(false)
            }
        }

        uploadPdfAutomatically()
    }, [paymentInfo.bookingId, paymentInfo.order, paymentInfo.clientName, isPdfUploaded, isUploadingPdf, paymentInfo])

    const handleDownloadPDF = async () => {
        try {
            setIsDownloading(true)
            
            console.log('[PDF Download] Descargando copia del PDF...')
            
            // Generar y descargar el PDF (true = descargar al dispositivo)
            const pdfResult = await generateHomePDF(paymentInfo, true)
            
            if (!pdfResult) {
                throw new Error('No se pudo generar el PDF')
            }

            console.log('[PDF Download] PDF descargado:', pdfResult.fileName)
            toast.success('📥 PDF descargado exitosamente')
            
        } catch (error) {
            console.error('[PDF Download] Error:', error)
            toast.error('Error al descargar el PDF')
        } finally {
            setIsDownloading(false)
        }
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-purple-50 via-white to-white py-12 px-4">
            <div className="max-w-2xl mx-auto">
                <Card variant="elevated" className="py-12">
                    {/* Icono de éxito */}
                    <div className="w-24 h-24 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-6 animate-bounce">
                        <CheckCircle className="w-16 h-16 text-purple-600" />
                    </div>

                    {/* Título */}
                    <h1 className="text-4xl font-bold text-gray-900 mb-4 text-center">
                        ¡Pago Exitoso!
                    </h1>

                    <p className="text-lg text-gray-600 mb-8 text-center">
                        Tu solicitud de cotización a domicilio ha sido confirmada
                    </p>

                    {/* Detalles del pago */}
                    <div className="bg-purple-50 border border-purple-200 rounded-lg p-6 mb-8">
                        <h3 className="font-semibold text-purple-900 mb-4 text-center">
                            📋 Detalles de la Transacción
                        </h3>
                        <div className="space-y-3">
                            {paymentInfo.order && (
                                <div className="flex justify-between items-center">
                                    <span className="text-sm text-gray-600">Número de Orden:</span>
                                    <span className="font-semibold text-gray-900">#{paymentInfo.order}</span>
                                </div>
                            )}
                            <div className="flex justify-between items-center">
                                <span className="text-sm text-gray-600">Servicio:</span>
                                <span className="font-semibold text-purple-700">🏠 Cotización a Domicilio</span>
                            </div>
                            <div className="flex justify-between items-center">
                                <span className="text-sm text-gray-600">Monto Pagado:</span>
                                <span className="font-bold text-green-600 text-xl">
                                    {formatCurrency(parseInt(paymentInfo.amount))}
                                </span>
                            </div>
                            <div className="flex justify-between items-center">
                                <span className="text-sm text-gray-600">Estado:</span>
                                <span className="font-semibold text-green-600">✓ Confirmado</span>
                            </div>
                        </div>
                    </div>

                    {/* Información del servicio */}
                    {paymentInfo.visitAddress && (
                        <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mb-8">
                            <h3 className="font-semibold text-blue-900 mb-3">📍 Dirección de Visita</h3>
                            <p className="text-sm text-gray-700">{paymentInfo.visitAddress}</p>
                        </div>
                    )}

                    {/* Próximos pasos */}
                    <div className="bg-gradient-to-r from-purple-50 to-purple-50 border border-purple-200 rounded-lg p-6 mb-8">
                        <h3 className="font-semibold mb-3 text-purple-900">📧 ¿Qué sigue?</h3>
                        <ul className="space-y-2 text-sm text-gray-700">
                            <li className="flex items-start gap-2">
                                <span className="text-green-600 mt-0.5">✅</span>
                                <span>Recibirás un correo de confirmación con los detalles de tu pago</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-green-600 mt-0.5">✅</span>
                                <span>Te contactaremos para coordinar la fecha y hora de la visita</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-green-600 mt-0.5">✅</span>
                                <span>Un profesional visitará tu hogar para realizar la cotización completa</span>
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-green-600 mt-0.5">✅</span>
                                <span>Recibirás una cotización detallada sin compromiso de contratación</span>
                            </li>
                        </ul>
                    </div>

                    {/* Acciones */}
                    <div className="space-y-6">
                        <Button 
                            variant="primary" 
                            className="w-full bg-purple-600 hover:bg-purple-700" 
                            size="lg"
                            onClick={handleDownloadPDF}
                            disabled={isDownloading}
                        >
                            {isDownloading ? (
                                <>
                                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                                    Generando PDF...
                                </>
                            ) : (
                                <>
                                    <Download className="w-5 h-5 mr-2" />
                                    Descargar Comprobante PDF
                                </>
                            )}
                        </Button>

                        <Link href="/" className="block mt-6">
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
                        <p className="text-sm font-semibold text-purple-600">
                            📞 +56 9 5233 4799 | 📧 contacto@yomeencargo.cl
                        </p>
                    </div>
                </Card>

                {/* Nota de seguridad */}
                <div className="mt-6 text-center">
                    <p className="text-xs text-gray-500">
                        🔒 Tu pago fue procesado de forma segura a través de Flow
                    </p>
                </div>
            </div>
        </div>
    )
}

function LoadingFallback() {
    return (
        <div className="min-h-screen bg-gradient-to-br from-purple-50 via-white to-white py-12 px-4">
            <div className="max-w-2xl mx-auto">
                <Card variant="elevated" className="py-12">
                    <div className="flex flex-col items-center justify-center">
                        <Loader2 className="w-16 h-16 text-purple-600 animate-spin mb-4" />
                        <p className="text-gray-600">Cargando información del pago...</p>
                    </div>
                </Card>
            </div>
        </div>
    )
}

export default function HomePaymentSuccessPage() {
    return (
        <Suspense fallback={<LoadingFallback />}>
            <PaymentSuccessContent />
        </Suspense>
    )
}
