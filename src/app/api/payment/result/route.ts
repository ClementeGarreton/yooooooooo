import { NextRequest, NextResponse } from 'next/server'
import { applyFlowPaymentByToken } from '@/lib/paymentSync'
import { siteUrl } from '@/lib/siteUrl'

// Función para generar HTML de redirección
function createRedirectHtml(url: string, message: string) {
    return `
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="refresh" content="0;url=${url}">
    <title>${message}</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
        }
        .container {
            text-align: center;
            padding: 2rem;
        }
        .spinner {
            width: 50px;
            height: 50px;
            border: 4px solid rgba(255,255,255,0.3);
            border-top-color: white;
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin: 0 auto 1rem;
        }
        @keyframes spin {
            to { transform: rotate(360deg); }
        }
        a {
            color: white;
            text-decoration: underline;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="spinner"></div>
        <h2>${message}</h2>
        <p>Redirigiendo...</p>
        <p><a href="${url}">Haz clic aquí si no eres redirigido automáticamente</a></p>
    </div>
    <script>
        window.location.href = "${url}";
    </script>
</body>
</html>
`
}

// Procesa el retorno del usuario después del pago.
async function processPaymentResult(token: string, baseUrl: string) {
    console.log('[RESULT] Token recibido:', token)

    // Siempre al dominio público (yomeencargo.cl), nunca al de Vercel: ver siteUrl.ts.
    // (evita problemas cuando Flow redirige desde una URL antigua).
    const appUrl = siteUrl()
    const origin = new URL(appUrl).origin

    // Misma lógica que el webhook: resuelve la reserva por optional.bookingId y actualiza el
    // pago de forma idempotente. Esto rescata el pago aunque el webhook no haya llegado.
    let paymentStatus
    let bookingData
    try {
        const result = await applyFlowPaymentByToken(token)
        paymentStatus = result.paymentStatus
        bookingData = result.bookingData
        console.log('[RESULT] Estado Flow:', paymentStatus.status, 'commerceOrder:', paymentStatus.commerceOrder)
    } catch (flowError) {
        console.error('[RESULT] Error al procesar el pago con Flow:', flowError)
        return {
            url: `${origin}/pago/error?reason=error&details=flow_connection_error`,
            message: 'Error de conexión'
        }
    }

    // Verificar estado del pago para redirigir al usuario
    // Flow status: 1 = pending, 2 = approved, 3 = rejected, 4 = cancelled
    if (paymentStatus.status === 2) {
        console.log('[RESULT] Pago APROBADO. Redirigiendo a éxito...')

        // Detectar cotización a domicilio vs mudanza online:
        // 1) por booking_type (si existe la migración), 2) por prefijo del commerceOrder.
        const isDomicilio = (bookingData && bookingData.booking_type === 'domicilio') ||
                           paymentStatus.commerceOrder.startsWith('DOMICILIO-')

        if (isDomicilio) {
            const params = new URLSearchParams({
                token: token,
                order: paymentStatus.flowOrder.toString(),
                amount: paymentStatus.amount.toString(),
                bookingId: bookingData?.id || '',
                clientName: bookingData?.client_name || '',
                clientEmail: bookingData?.client_email || '',
                visitAddress: bookingData?.visit_address || ''
            })
            return {
                url: `${origin}/domicilio/exito?${params.toString()}`,
                message: '¡Pago Exitoso!'
            }
        } else {
            const params = new URLSearchParams({
                token: token,
                order: paymentStatus.flowOrder.toString(),
                amount: paymentStatus.amount.toString(),
                quoteId: paymentStatus.commerceOrder
            })
            return {
                url: `${origin}/pago/exito?${params.toString()}`,
                message: '¡Pago Exitoso!'
            }
        }
    } else if (paymentStatus.status === 3) {
        console.log('[RESULT] Pago RECHAZADO')
        return {
            url: `${origin}/pago/error?reason=rejected`,
            message: 'Pago Rechazado'
        }
    } else if (paymentStatus.status === 4) {
        console.log('[RESULT] Pago CANCELADO')
        return {
            url: `${origin}/pago/error?reason=cancelled`,
            message: 'Pago Cancelado'
        }
    } else {
        console.log('[RESULT] Pago PENDIENTE o estado desconocido:', paymentStatus.status)
        return {
            url: `${origin}/pago/error?reason=pending`,
            message: 'Pago Pendiente'
        }
    }
}

// Retorno del usuario via GET
export async function GET(request: NextRequest) {
    try {
        console.log('Procesando retorno de pago (GET)...')
        const token = request.nextUrl.searchParams.get('token')

        if (!token) {
            console.error('Error: No token provided in query params')
            const appUrl = siteUrl()
            const origin = new URL(appUrl).origin
            const html = createRedirectHtml(`${origin}/pago/error?reason=no_token`, 'Error')
            return new NextResponse(html, {
                headers: { 'Content-Type': 'text/html; charset=utf-8' }
            })
        }

        const result = await processPaymentResult(token, request.url)
        const html = createRedirectHtml(result.url, result.message)
        return new NextResponse(html, {
            headers: { 'Content-Type': 'text/html; charset=utf-8' }
        })
    } catch (error) {
        console.error('Error processing payment result GET (Critical):', error)
        const appUrl = siteUrl()
        const origin = new URL(appUrl).origin
        const html = createRedirectHtml(`${origin}/pago/error?reason=error`, 'Error')
        return new NextResponse(html, {
            headers: { 'Content-Type': 'text/html; charset=utf-8' }
        })
    }
}

// Retorno del usuario via POST (Flow envía el token como form-urlencoded)
export async function POST(request: NextRequest) {
    try {
        console.log('Procesando retorno de pago (POST)...')

        const formData = await request.formData()
        const token = formData.get('token') as string

        if (!token) {
            console.error('Error: No token provided in POST body')
            const appUrl = siteUrl()
            const origin = new URL(appUrl).origin
            const html = createRedirectHtml(`${origin}/pago/error?reason=no_token`, 'Error')
            return new NextResponse(html, {
                headers: { 'Content-Type': 'text/html; charset=utf-8' }
            })
        }

        const result = await processPaymentResult(token, request.url)
        const html = createRedirectHtml(result.url, result.message)
        return new NextResponse(html, {
            headers: { 'Content-Type': 'text/html; charset=utf-8' }
        })
    } catch (error) {
        console.error('Error processing payment result POST (Critical):', error)
        const appUrl = siteUrl()
        const origin = new URL(appUrl).origin
        const html = createRedirectHtml(`${origin}/pago/error?reason=error`, 'Error')
        return new NextResponse(html, {
            headers: { 'Content-Type': 'text/html; charset=utf-8' }
        })
    }
}
